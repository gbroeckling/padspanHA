# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Opt-in usage statistics — "help the developer improve PadSpan".

OFF by default. Nothing here runs until a person turns it on in Settings →
Presence → Help improve PadSpan, where a Preview button shows the exact JSON
that will go. What goes out is COUNTS and VERSIONS, never things:

    which version, which edition and tier, which Home Assistant
    how many scanners / floors / rooms / placed lights / walls / maps / IRKs
    which feature switches are on
    how many times each tab was opened and each feature used since the
        last report (an allow-listed vocabulary — see EVENTS)
    a few health flags: crypto present, BLE callback alive, coverage floor
        active, how many rotating addresses actually resolved
    whether the building is described at all: floors carrying a real
        storey height, scanners carrying a mounting height, calibration
        points that never got a floor, whether any map is measured
    uncaught panel errors by view — the half of PadSpan the Python log
        cannot see (see UI_ERRORS)

The reason, in one sentence: the developer has one house to test on, and
this is how features that only exist elsewhere (an iPhone with an IRK, a
Bermuda install, twelve floors, a lighting-only house) get seen at all.

Never: MAC addresses, IRKs or licence keys, device or room or floor NAMES,
coordinates, entity ids, timestamps finer than the day. `assert_shareable`
walks every value before a send and refuses the whole report if anything
identifier-shaped is in it — belt on top of the design's braces — and
tests/test_telemetry.py builds a payload from a house full of names and MACs
and proves none of them are in it.

The install id is a random UUID minted the first time the switch goes on. It
exists so installs can be counted rather than pings; "New anonymous ID" in
the same card replaces it. It is the only thing that persists across
reports, and it means nothing outside this file.

Endpoint: TELEMETRY_URL. At most one POST per UTC day (the last sent day is
persisted, so restarts do not repeat it), about 2 KB, hard cap 8 KB. Failure
is silent and non-fatal; nothing is retried, nothing is queued; the counters
survive a failed send and go with the next one.
"""

from __future__ import annotations

import json
import logging
import re
import time
import uuid
from datetime import timedelta
from typing import Any

from homeassistant.core import HomeAssistant

from .build_info import BUILD_VERSION
from .const import (
    DATA_FABRIC,
    DATA_MAPS,
    DATA_MODEL,
    DATA_SETTINGS,
    DOMAIN,
)

_LOGGER = logging.getLogger(__name__)

TELEMETRY_URL = "https://padspan.traks.ca/api/telemetry.php"
# The developer's view of what the reports add up to (server/stats.php).
# Read-only, other people's installs in aggregate; the server admits only a
# key on its developer list, so the Pro + Dev-mode gate in the panel is a
# courtesy and the server is the lock.
STATS_URL = "https://padspan.traks.ca/api/stats.php"
SCHEMA = 1
_INTERVAL = timedelta(hours=24)
_FIRST_DELAY_S = 600           # after the update check, never during startup
_DATA_UNSUBS = "_telemetry_unsubs"
_DATA_COUNTERS = "telemetry_counters"
_DATA_STARTED = "_telemetry_started_mono"
_MAX_BYTES = 8192

# The vocabulary. An event that is not here is dropped, so the frontend and
# every backend call site can only ever count what this file allows — a
# closed list, because the report's KEYS are also data that leaves the box,
# and an open pattern would let any authenticated user put a word into it.
EVENTS: frozenset[str] = frozenset({
    "light_placed", "light_removed", "wall_placed", "wall_removed",
    "room_committed", "irk_added", "irk_add_refused", "irk_validate",
    "calibration_point_added", "capture_started", "forensics_query",
    "showcase_on", "backup_created", "backup_restored", "factory_reset",
    "bright_import",
    # Map placement repairs, both directions. The fault COUNT in health says
    # how many installs carry a broken map; these say whether people find the
    # repair and which way it needed to go — a repair that nobody ever runs is
    # a repair nobody can find.
    "map_align_to_stack", "map_stack_rebuilt",
    # The two tools that rewrite a map's placement through the stack algebra
    # (issue #64): a completed master swap, one the wizard refused because the
    # new master's placement could not be inverted, and a Point Align applied.
    # `health.stack_desync` counts maps left describing two footprints; these
    # are its denominator — without them a zero means "fixed" and "nobody ran
    # it" in the same breath.
    "master_changed", "master_change_refused", "point_align_applied",
    # IRK resolution, cumulative over the window: a NEW address resolved to a
    # registered key; a NEW rotating address that matched no key.
    "irk_resolved", "irk_unresolved_rpa",
})
# The panel's views (panel.js _VIEW_PATHS — tests/test_telemetry.py asserts
# equality) and the sub-tabs of the two views that have them.
VIEWS: frozenset[str] = frozenset({
    "follow", "overview", "purelive", "objects", "devices", "bluetooth", "presence",
    "history", "monitor", "maps", "events", "health", "settings", "manage", "debug",
    "diagnostics", "qa", "training", "calibration", "traceback", "forensics",
    "sandbox", "occupancy", "installbase",
})
SUBTABS: dict[str, frozenset[str]] = {
    "bluetooth": frozenset({"visualization", "monitor", "scanners", "irk_panel", "esphome_configs"}),
    "maps": frozenset({"library", "upload", "edit", "stack", "rooms", "lights", "export", "help"}),
}
TAB_EVENTS: frozenset[str] = frozenset(
    {f"tab:{v}" for v in VIEWS} | {f"tab:{v}/{s}" for v, subs in SUBTABS.items() for s in subs}
)
# Uncaught panel errors, counted by the view that was open when one landed.
# The panel is the half of PadSpan the Python log cannot see: v0.35.0 shipped
# a Mapping tab that threw before it re-rendered, so the previous tab stayed
# on screen and it read as a hang. Nothing moved in `errors`, and it took a
# user describing it in prose to find. A COUNT per view — never the message,
# never a stack, never anything the page happened to be holding.
UI_ERRORS: frozenset[str] = frozenset({f"ui_error:{v}" for v in VIEWS})

# The switches whose ON/OFF is reported (booleans only, by name). Every name
# here must be READ by something outside the settings plumbing — a switch
# that drives nothing is not a feature, and reporting it would put a fiction
# in the data (tests/test_telemetry.py holds the list to that).
_FEATURE_FLAGS: tuple[str, ...] = (
    "quiet_mode", "lights_showcase", "lights_fit_rooms", "lights_hide_untouched",
    "lights_panel_enabled", "radio_map_enabled", "distortion_map_enabled",
    "occupancy_hybrid_enabled", "rssi_capture_enabled", "forensics_enabled",
    "mac_rotation_bridging", "beacon_auto_calibrate", "beacon_profiling_enabled",
    "espresense_mqtt_enabled", "mqtt_publish_enabled", "bermuda_ignore",
    "phone_wizard_enabled", "overview_show_walls", "overview_show_outdoor",
    "overview_2d_mode", "overview_persistent_pins",
    "walk_to_identify_enabled",
    "adaptive_floor_detection", "apple_auto_classify", "aggressive_ble_reseed",
    "ha_entity_tracker_enabled", "ha_entity_area_enabled", "ha_entity_distance_enabled",
    "ha_entity_scanner_distance_enabled", "ha_entity_occupancy_enabled",
    "tags_room_events_enabled", "tags_nfc_identify_enabled", "tags_phone_autolink_enabled",
    "update_check_enabled", "onboarding_completed",
)
# Small enumerations reported by value (each from a fixed vocabulary in
# ws_settings; anything unexpected is dropped by assert_shareable's length rule).
_FEATURE_ENUMS: tuple[str, ...] = ("data_mode", "cpu_mode")

# What a report may contain at the top level — anything else is a bug.
_TOP_KEYS: frozenset[str] = frozenset({
    "schema", "install_id", "day", "version", "edition", "tier", "ha_version",
    "python", "env", "features", "usage", "health", "errors",
})

# Identifier shapes that must never appear in any value.
_MAC_RE = re.compile(r"\b[0-9A-Fa-f]{2}(?:[:\-.][0-9A-Fa-f]{2}){5}\b|\b[0-9A-Fa-f]{12}\b")   # 48:87:…, 48-87-…, 48.87.…, 48872D9DBC88
_UUID_RE = re.compile(r"\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\b")
_HEX32_RE = re.compile(r"\b[0-9A-Fa-f]{32}\b")
_KEY_RE = re.compile(r"\bPSPAN-[A-Z0-9-]{8,}\b", re.I)
_IPV4_RE = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")
_IPV6_RE = re.compile(r"\b(?:[0-9A-Fa-f]{1,4}:){2,7}[0-9A-Fa-f]{1,4}\b")
_ENTITY_RE = re.compile(r"\b[a-z_]{2,}\.[a-z0-9_]{2,}\b")          # light.kitchen_valance, sensor.x


# ── counting ─────────────────────────────────────────────────────────────────

def enabled(hass: HomeAssistant) -> bool:
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    return bool((st.data if st else {}).get("telemetry_enabled", False))


def event_allowed(name: str) -> bool:
    return name in EVENTS or name in TAB_EVENTS or name in UI_ERRORS


def bump(hass: HomeAssistant, event: str, n: int = 1) -> bool:
    """Count one occurrence. Silently ignored when off or unknown.

    Cheap enough to call from any write path: a dict increment when on, one
    lookup when off. Returns whether it counted.
    """
    if not event_allowed(event) or not enabled(hass):
        return False
    dom = hass.data.setdefault(DOMAIN, {})
    counters: dict[str, int] = dom.setdefault(_DATA_COUNTERS, {})
    counters[event] = int(counters.get(event, 0)) + max(1, int(n))
    return True


def _take_counters(hass: HomeAssistant) -> dict[str, int]:
    """The counters since the last report — and reset them."""
    dom = hass.data.setdefault(DOMAIN, {})
    out = dict(dom.get(_DATA_COUNTERS) or {})
    dom[_DATA_COUNTERS] = {}
    return out


# ── the report ───────────────────────────────────────────────────────────────

def _uptime_bucket(seconds: float) -> str:
    if seconds < 3600:
        return "<1h"
    if seconds < 86400:
        return "<1d"
    if seconds < 7 * 86400:
        return "1-7d"
    return ">7d"


def _len(x: Any) -> int:
    try:
        return len(x)
    except Exception:
        return 0


def _positioning_now(coord) -> dict[str, int]:
    """What the engine did with the house's own objects this poll.

    Read from the coordinator's poll result — the same dict the live
    snapshot overlays onto objects — because the cached snapshot never
    carries `outside` or the solver's counts: both are attached per request
    inside ws_live_snapshot, so reading them off the cache reported 0 on
    every install, forever. Gated on is_identified_object, the engine's own
    test, so the count is of the house and not of the neighbourhood.
    """
    out = {"positioned": 0, "outside": 0}
    data = getattr(coord, "data", None)
    ident = getattr(coord, "is_identified_object", None)
    if not isinstance(data, dict) or not callable(ident):
        return out
    for key, v in data.items():
        if not isinstance(v, dict):
            continue
        try:
            if not ident(key):
                continue
        except Exception:
            continue
        if v.get("x_m") is not None and v.get("y_m") is not None:
            out["positioned"] += 1
        if v.get("outside"):
            out["outside"] += 1
    return out


def build_payload(hass: HomeAssistant, *, consume: bool = False) -> dict[str, Any]:
    """The report. `consume` resets the usage counters (a real send does;
    the Preview does not, so previewing never loses a day's counts)."""
    from .licence import edition as _edition, hass_tier as _tier  # noqa: PLC0415
    dom = hass.data.get(DOMAIN, {})
    st = dom.get(DATA_SETTINGS)
    settings: dict[str, Any] = (st.data if st else {}) or {}

    try:
        from homeassistant.const import __version__ as _HA_VERSION  # noqa: PLC0415
        ha_version = str(_HA_VERSION)
    except Exception:
        ha_version = ""

    # Environment — sizes of things, from the stores that own them.
    fab = getattr(dom.get(DATA_FABRIC), "data", None) or {}
    floors = fab.get("floors") if isinstance(fab.get("floors"), dict) else {}
    rooms = sum(_len(f.get("rooms") or {}) for f in floors.values() if isinstance(f, dict))
    mdl = getattr(dom.get(DATA_MODEL), "data", None) or {}
    maps = getattr(dom.get(DATA_MAPS), "data", None) or {}
    snap_entry = dom.get("snapshot_cache")
    snap = snap_entry[1] if isinstance(snap_entry, tuple) and len(snap_entry) == 2 and isinstance(snap_entry[1], dict) else {}
    ble = snap.get("ble") if isinstance(snap.get("ble"), dict) else {}
    objects = snap.get("objects") if isinstance(snap.get("objects"), dict) else {}
    summary = objects.get("summary") if isinstance(objects.get("summary"), dict) else {}
    resolver = summary.get("resolver") if isinstance(summary.get("resolver"), dict) else {}
    diag = ble.get("diag") if isinstance(ble.get("diag"), dict) else {}
    obj_list = objects.get("list") if isinstance(objects.get("list"), list) else []

    integrations = {}
    for name in ("private_ble_device", "bermuda", "esphome", "mqtt", "bluetooth", "mobile_app", "ibeacon", "espresense"):
        try:
            integrations[name] = _len(hass.config_entries.async_entries(name))
        except Exception:
            integrations[name] = 0

    radios = [r for r in (ble.get("radios") or []) if isinstance(r, dict)]
    scanner_kinds = {
        # "ip_known" = the scanner exposes diagnostic sensors PadSpan reads
        # (an ESPHome proxy set up with the config library); "espresense" by
        # source; the rest are proxies without diagnostics or local adapters.
        "ip_known": sum(1 for r in radios if r.get("ip")),
        "espresense": sum(1 for r in radios if str(r.get("source") or "").lower().startswith("espresense")),
    }
    scanner_kinds["other"] = max(0, len(radios) - scanner_kinds["ip_known"] - scanner_kinds["espresense"])
    scanner_state = {
        "lost": sum(1 for r in radios if r.get("lost")),
        "disabled": sum(1 for r in radios if r.get("disabled")),
        "excluded": _len(settings.get("excluded_scanners") or []),
    }
    by_kind: dict[str, int] = {}
    for o in obj_list:
        if isinstance(o, dict):
            k = str(o.get("kind") or "?")[:16]
            by_kind[k] = by_kind.get(k, 0) + 1
    cal = getattr(dom.get("calibration"), "data", None) or {}
    cal_points = cal.get("points") if isinstance(cal.get("points"), list) else []
    # Beacon auto-calibration marks its points in the LABEL (`[auto] …`,
    # presence_coordinator / calibration_store.prune_auto_points); there has
    # never been a `source` key, and reading one counted zero on every install.
    cal_auto = sum(1 for p in cal_points if isinstance(p, dict) and str(p.get("label") or "").startswith("[auto]"))
    # Points that never got a floor. Since #54 such a point is no longer
    # assumed to be on the ground — it stays 2D — which fixed the phantom
    # elevation but left the point contributing nothing to the storey it was
    # actually captured on. That is invisible from the panel: the point is
    # there, it looks captured, and the floor quietly has fewer than it shows.
    # `async_backfill_floors` repairs them; this is how an install that needs
    # repairing says so without anyone having to notice first.
    cal_no_floor = sum(1 for p in cal_points if isinstance(p, dict)
                       and not str(p.get("floor_id") or "").strip())

    # Is the building described, or is it defaults wearing a building's shape?
    # A floor with no explicit floor_to_floor_m or base_elevation_m falls back
    # to DEFAULT_FLOOR_TO_FLOOR_M, and a scanner with no z_m has no mounting
    # height — either one leaves cross-floor positioning with nothing to
    # separate storeys by. PadSpan is developed against one house, where both
    # are always set, so this is the case the developer cannot see at all.
    mdl_floors = [f for f in (mdl.get("floors") or []) if isinstance(f, dict)]

    def _explicit(f: dict[str, Any]) -> bool:
        for k in ("floor_to_floor_m", "base_elevation_m"):
            v = f.get(k)
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                return True
        return False

    floors_with_height = sum(1 for f in mdl_floors if _explicit(f))
    _z_vals = [float(v["z_m"]) for v in (fab.get("scanner_positions_m") or {}).values()
               if isinstance(v, dict) and isinstance(v.get("z_m"), (int, float))
               and not isinstance(v.get("z_m"), bool)]
    scanner_z_distinct = len({round(z, 2) for z in _z_vals})
    coord = dom.get("presence_coordinator")
    _pos = _positioning_now(coord)
    # Registered keys that resolved at least one address in the window — the
    # answer to "does the IRK path work anywhere". Read without resetting on
    # a preview; a send resets it with the other windows.
    resolving = 0
    _identity = {"total": 0, "resolving": 0, "silent": 0, "by_source": {}, "has_any": False}
    try:
        from .private_ble_resolver import _resolvers  # noqa: PLC0415
        _res = _resolvers.get(id(hass))
        if _res is not None:
            _ids = _res.take_resolved_ids() if consume else set(_res._resolved_ids_window)
            resolving = len(_ids)
            _identity = _res.identity_breakdown(_ids)
    except Exception:
        resolving = 0

    # Read-only self-check: maps whose geometry disagrees with itself.
    _geometry_faults = 0
    _anchor_faulted = False
    # Whether ANY map is measured. Without one there is no metre anchor, so
    # scale comes from a fallback and every distance in the house is a guess
    # wearing units. A user reported measuring a map and seeing "no reflection
    # of it" — from a report alone that install and a correctly measured one
    # were identical, because absence was the one thing never sent.
    _has_anchor = False
    # Which of the three signals actually tripped. A lumped fault count says
    # something is wrong and nothing about what, which sends the developer
    # back to asking for screenshots — the exact loop this report exists to
    # end. They overlap by design: one map can trip more than one.
    _fault_iso = 0
    _fault_scale = 0
    _fault_origin = 0
    # Maps placed by Point Align, and whether the map anchoring the whole
    # house is one of them. The anchor's KIND is the discriminator for issue
    # #62: a trimmed Point-Aligned map and a trimmed ordinary one fail in
    # different ways, and from a fault count alone the two are identical.
    _maps_affine = 0
    _anchor_affine = False
    # Point-Aligned maps whose matrix and whose decomposed fields no longer
    # describe the same footprint. Nothing else can see this: such a map draws
    # correctly through its matrix while every stored number disagrees. It is
    # the exposure metric for #64 step 3, which is known and not yet fixed.
    _stack_desync = 0
    try:
        from . import fabric_truth as _ft  # noqa: PLC0415
        _mdl_store = dom.get(DATA_MODEL)
        _maps_list = maps.get("maps") or []
        if _mdl_store is not None:
            _faults = _ft.map_geometry_faults(_maps_list, _mdl_store)
            _geometry_faults = len(_faults)
            _anchor_faulted = any(f.get("is_anchor") for f in _faults)
            for _f in _faults:
                if float(_f.get("iso_error") or 0) > _ft.ANCHOR_ISO_TOL:
                    _fault_iso += 1
                if float(_f.get("scale_error_frac") or 0) > _ft.GEOMETRY_SCALE_TOL:
                    _fault_scale += 1
                if float(_f.get("origin_delta_m") or 0) > _ft.GEOMETRY_ORIGIN_TOL_M:
                    _fault_origin += 1
            _anchor = _ft.find_metre_anchor(_maps_list, _mdl_store) or {}
            _anchor_id = _anchor.get("map_id")
            _has_anchor = bool(_anchor_id)
            for _m in _maps_list:
                _raw = (_m.get("stack") or {}).get("_m")
                if isinstance(_raw, (list, tuple)) and len(_raw) == 4:
                    _maps_affine += 1
                    if _m.get("id") == _anchor_id:
                        _anchor_affine = True
                _d = _ft.stack_desync(_m)
                if _d is not None and _d > _ft.ANCHOR_ISO_TOL:
                    _stack_desync += 1
    except Exception:
        pass

    env = {
        "scanners": len(radios),
        "scanner_kinds": scanner_kinds,
        "scanner_state": scanner_state,
        "floors": _len(floors) or _len(mdl.get("floors") or []),
        "rooms": rooms,
        "placed_lights": _len(fab.get("light_positions_m") or {}),
        "walls": _len(fab.get("rf_barriers_m") or []),
        "maps": _len(maps.get("maps") or []),
        "scanner_positions": _len(fab.get("scanner_positions_m") or {}),
        "beacon_positions": _len(fab.get("beacon_positions_m") or {}),
        "calibration_points": _len(cal_points),
        "calibration_auto_points": cal_auto,
        "calibration_no_floor": cal_no_floor,
        "floors_with_height": floors_with_height,
        "scanners_with_z": len(_z_vals),
        "irks": _len(settings.get("irk_devices") or []),
        "followed": _len(settings.get("followed_addrs") or []),
        "objects_total": _len(obj_list),
        "objects_identified": sum(1 for o in obj_list if isinstance(o, dict) and o.get("identified")),
        "objects_by_kind": by_kind,
        "integrations": integrations,
    }
    features = {k: bool(settings.get(k)) for k in _FEATURE_FLAGS}
    for k in _FEATURE_ENUMS:
        v = settings.get(k)
        if isinstance(v, str) and 0 < len(v) <= 16:
            features[k] = v
    started = dom.get(_DATA_STARTED)
    health = {
        "crypto_ok": bool(resolver.get("crypto_ok", True)),
        "ble_callback_active": diag.get("callback_active") is not False,
        "ble_diag_ok": diag.get("ok") is not False,
        # NOT a resolution health metric, whatever the ratio looks like.
        # count_rpas() counts every structurally-resolvable address on the
        # air, which is every rotating device in radio range and therefore
        # mostly other people's phones. This describes the radio ENVIRONMENT
        # — how crowded it is, which bears on history size and CPU. Read
        # identity health from irks_* below, never from these two.
        "rpas_seen": int(resolver.get("rpa_count") or 0),
        "rpas_resolved": int(resolver.get("resolved") or 0),
        "resolver_errors": _len(resolver.get("errors") or []),
        "irk_devices_resolving": resolving,
        # Registered identities, and how many of them produced nothing at all.
        # `irks_silent` is the failure this report previously could not see: a
        # key that never matches looked exactly like a key nobody added.
        "irks_total": int(_identity.get("total") or 0),
        "irks_silent": int(_identity.get("silent") or 0),
        # Zeros above are only readable next to this. "None configured" and
        # "none working" are the same number and completely different bugs.
        "has_any_identity": bool(_identity.get("has_any")),
        # Which door the identities came in by, and which door actually works.
        # Fixed labels from PrivateBLEResolver.IDENTITY_SOURCES — no names.
        "irks_by_source": {k: v.get("total", 0)
                           for k, v in (_identity.get("by_source") or {}).items()},
        "irks_resolving_by_source": {k: v.get("resolving", 0)
                                     for k, v in (_identity.get("by_source") or {}).items()},
        "outside_now": _pos["outside"],
        "coverage_floor_active": getattr(coord, "_coverage_floor", None) is not None,
        # Identified objects the engine placed this poll, and judged outside.
        "positioned_now": _pos["positioned"],
        # How long since HA (re)started, coarsely — restart churn is a health
        # signal; a start time finer than that would be one thing too many.
        "uptime": _uptime_bucket(time.monotonic() - started) if isinstance(started, (int, float)) else "unknown",
        # Maps whose stored scale and stored placement no longer describe the
        # same picture, and whether one of them is the map anchoring the house
        # (which makes rooms wrong on every OTHER floor too). A COUNT and a
        # flag — no map names, no coordinates, nothing about the building.
        # This class of bug cost a user weeks of screenshots to surface once.
        "maps_geometry_faulted": _geometry_faults,
        "geometry_anchor_faulted": _anchor_faulted,
        "geometry_fault_iso": _fault_iso,
        "geometry_fault_scale": _fault_scale,
        "geometry_fault_origin": _fault_origin,
        "maps_affine": _maps_affine,
        "anchor_is_affine": _anchor_affine,
        "stack_desync": _stack_desync,
        # The three "is it set up at all" flags. Each is only meaningful on a
        # multi-storey house, so each carries the floor test in it rather than
        # leaving a bare False to be misread as a fault on a bungalow.
        "has_metre_anchor": _has_anchor,
        "floors_all_default": bool(len(mdl_floors) > 1 and floors_with_height == 0),
        "scanner_z_uniform": bool(len(mdl_floors) > 1 and len(radios) > 1
                                  and scanner_z_distinct <= 1),
        # How each scanner was matched to its HA device. `ambiguous` is the
        # one that matters: it means two scanners are named so that one
        # contains the other, which is the condition that used to assign an
        # area to the wrong radio (issue #65) and now refuses instead. A count
        # of installs carrying that naming is the only way to know whether the
        # refusal is rare or whether people hit it constantly and need the
        # names checked at setup. `unresolved` says the scanner has no HA
        # device at all, which is a different problem wearing the same face.
        # Counts by outcome only — never which radios, never their names.
        "radios_ambiguous": sum(1 for r in radios if r.get("device_match") == "ambiguous"),
        "radios_unresolved": sum(1 for r in radios if r.get("device_match") == "none"),
        "radios_matched_partial": sum(1 for r in radios if r.get("device_match") == "partial"),
    }
    usage = _take_counters(hass) if consume else dict(dom.get(_DATA_COUNTERS) or {})
    # WARNING+ log lines by module since the last report — the "what broke"
    # signal for the parts of the code the developer cannot exercise.
    errors: dict[str, int] = {}
    try:
        from .ws_common import _log_handler  # noqa: PLC0415
        if _log_handler is not None:
            errors = _log_handler.take_counts() if consume else dict(_log_handler.counts)
    except Exception:
        errors = {}

    import sys as _sys  # noqa: PLC0415
    payload = {
        "schema": SCHEMA,
        "install_id": str(settings.get("telemetry_install_id") or ""),
        "day": time.strftime("%Y-%m-%d", time.gmtime()),
        "version": BUILD_VERSION,
        "edition": _edition(),
        "tier": _tier(hass),
        "ha_version": ha_version,
        "python": f"{_sys.version_info.major}.{_sys.version_info.minor}",
        "env": env,
        "features": features,
        "usage": usage,
        "health": health,
        "errors": errors,
    }
    return payload


def assert_shareable(payload: dict[str, Any]) -> None:
    """Refuse a report that carries anything identifier-shaped.

    Walks every key and value. Raises ValueError naming the offence. The
    install id is exempt from the UUID rule by position (it IS a UUID, by
    design, and nothing else); every other UUID/MAC/32-hex/key/IP anywhere
    is a bug — the report is built from counts, so there is no honest way
    for one to be there.
    """
    if not isinstance(payload, dict):
        raise ValueError("payload is not a dict")
    extra = set(payload.keys()) - _TOP_KEYS
    if extra:
        raise ValueError(f"unexpected top-level keys: {sorted(extra)}")

    def walk(node: Any, path: str) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                walk(str(k), path + "." + str(k) + "<key>")
                walk(v, path + "." + str(k))
        elif isinstance(node, (list, tuple)):
            for i, v in enumerate(node):
                walk(v, f"{path}[{i}]")
        elif isinstance(node, str):
            if path == ".install_id":
                if node and not _UUID_RE.fullmatch(node):
                    raise ValueError("install_id is not a UUID")
                return
            # Most specific first, so the message names the real shape (a
            # UUID's tail is also twelve hex digits).
            for name, rx in (("UUID", _UUID_RE), ("32-hex", _HEX32_RE), ("licence key", _KEY_RE),
                             ("MAC address", _MAC_RE), ("IP address", _IPV4_RE),
                             ("IPv6 address", _IPV6_RE), ("entity id", _ENTITY_RE)):
                if rx.search(node):
                    raise ValueError(f"{name} in {path}")
            if len(node) > 64:
                raise ValueError(f"string too long in {path}")
        elif node is None or isinstance(node, (bool, int, float)):
            return
        else:
            raise ValueError(f"unexpected value type {type(node).__name__} in {path}")

    walk(payload, "")
    if len(json.dumps(payload)) > _MAX_BYTES:
        raise ValueError("payload too large")


# ── the schedule ─────────────────────────────────────────────────────────────

async def ensure_install_id(hass: HomeAssistant) -> str:
    """Mint the anonymous id on first use; return it."""
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not st:
        return ""
    cur = str(st.data.get("telemetry_install_id") or "")
    if cur and _UUID_RE.fullmatch(cur):
        return cur
    new = str(uuid.uuid4())
    await st.async_set(telemetry_install_id=new)
    return new


def _today() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


async def ensure_snapshot(hass: HomeAssistant) -> None:
    """Make sure there IS a snapshot to read the environment from.

    Half the report — scanners, objects, resolver health — comes from the
    live snapshot, which is built on demand and cached. A report sent ten
    minutes after a restart, with nobody looking at the panel, would
    otherwise say "0 scanners, 0 objects" about a full house. Measured on
    the first real send: exactly that. The builder serves its own cache when
    one is fresh, so this costs nothing when the panel is open.
    """
    try:
        from .snapshot_builder import _live_snapshot  # noqa: PLC0415
        await _live_snapshot(hass)
    except Exception as err:
        _LOGGER.debug("Telemetry could not build a snapshot: %s", err)


async def send_now(hass: HomeAssistant, *, force: bool = False) -> dict[str, Any]:
    """Build, check, POST. Returns {"sent": bool, "reason": str, "bytes": n}.

    At most one report per UTC day: the day of the last successful send is
    persisted (`telemetry_last_day`), so a restart or reload does not send
    again — the scheduler fires 10 minutes after every start. `force` is the
    "Send a report now" button. Counters are consumed only after the report
    passed the gate and the POST was accepted, so a refused or failed send
    keeps the day's counts for the next attempt.
    """
    if not enabled(hass):
        return {"sent": False, "reason": "disabled", "bytes": 0}
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not force and st and str(st.data.get("telemetry_last_day") or "") == _today():
        return {"sent": False, "reason": "already sent today", "bytes": 0}
    await ensure_install_id(hass)
    await ensure_snapshot(hass)
    payload = build_payload(hass, consume=False)
    try:
        assert_shareable(payload)
    except ValueError as err:
        _LOGGER.error("Telemetry report refused before sending: %s", err)
        return {"sent": False, "reason": f"refused: {err}", "bytes": 0}
    body = json.dumps(payload).encode()
    try:
        from homeassistant.helpers.aiohttp_client import async_get_clientsession  # noqa: PLC0415
        session = async_get_clientsession(hass)
        async with session.post(TELEMETRY_URL, data=body,
                                headers={"Content-Type": "application/json"}, timeout=15) as resp:
            ok = 200 <= resp.status < 300
            if not ok:
                _LOGGER.debug("Telemetry HTTP %s", resp.status)
                return {"sent": False, "reason": f"http {resp.status}", "bytes": len(body)}
    except Exception as err:  # network errors are expected and non-fatal
        _LOGGER.debug("Telemetry send failed: %s", err)
        return {"sent": False, "reason": "network", "bytes": len(body)}
    # Accepted: now the window closes.
    _take_counters(hass)
    try:
        from .private_ble_resolver import _resolvers  # noqa: PLC0415
        _r = _resolvers.get(id(hass))
        if _r is not None:
            _r.take_resolved_ids()
    except Exception:
        pass
    try:
        from .ws_common import _log_handler  # noqa: PLC0415
        if _log_handler is not None:
            _log_handler.take_counts()
    except Exception:
        pass
    if st:
        try:
            await st.async_set(telemetry_last_day=_today())
        except Exception:
            pass
    return {"sent": True, "reason": "", "bytes": len(body)}


def reset_windows(hass: HomeAssistant) -> None:
    """Start the usage and error windows now — called at opt-in, so the first
    report carries nothing from before the person said yes."""
    hass.data.setdefault(DOMAIN, {})[_DATA_COUNTERS] = {}
    try:
        from .ws_common import _log_handler  # noqa: PLC0415
        if _log_handler is not None:
            _log_handler.take_counts()
    except Exception:
        pass
    try:
        from .private_ble_resolver import _resolvers  # noqa: PLC0415
        _r = _resolvers.get(id(hass))
        if _r is not None:
            _r.take_resolved_ids()
    except Exception:
        pass


def async_setup_telemetry(hass: HomeAssistant) -> None:
    """Schedule the daily report (idempotent across reloads). Runs only when on."""
    from homeassistant.helpers.event import async_call_later, async_track_time_interval  # noqa: PLC0415

    dom = hass.data.setdefault(DOMAIN, {})
    dom.setdefault(_DATA_STARTED, time.monotonic())
    if dom.get(_DATA_UNSUBS):
        return

    async def _run(_now: Any = None) -> None:
        if enabled(hass):
            await send_now(hass)

    dom[_DATA_UNSUBS] = [
        async_call_later(hass, _FIRST_DELAY_S, _run),
        async_track_time_interval(hass, _run, _INTERVAL),
    ]


def async_stop_telemetry(hass: HomeAssistant) -> None:
    for unsub in hass.data.get(DOMAIN, {}).pop(_DATA_UNSUBS, []) or []:
        try:
            unsub()
        except Exception:
            pass
