# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
PadSpan HA — Settings Store
=============================
Persistent UI settings — toggling sample/live mode, tuning BLE parameters
(ref power, path-loss exponent, Kalman Q/R), controlling which
entity types are published, and storing per-scanner RSSI offsets.

All settings live in a single flat dict persisted to
``.storage/padspan_ha.settings``.  Unknown keys from future versions are
preserved on load (merged onto DEFAULT_SETTINGS).
"""


import logging
from dataclasses import dataclass
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import SETTINGS_STORE_KEY

_LOGGER = logging.getLogger(__name__)

DEFAULT_SETTINGS: dict[str, Any] = {
    "data_mode": "sample",  # "sample" | "live"
    "cpu_mode": "shared",  # "shared" | "single" | "dedicated" — see PresenceCoordinator
    "update_check_enabled": True,  # daily version ping to padspan.traks.ca (see README)
    "vendor_lookup_enabled": True,  # Sends MAC prefixes to vendor lookup APIs when requested from UI
    "ref_power":      -59.0,   # dBm RSSI at 1 m (distance formula)
    "path_loss_exp":   2.5,    # path-loss exponent n (distance formula)
    "hidden_map_ids":  [],     # map IDs hidden from 3D stack view
    "scanner_offsets": {},     # {source_name: offset_dBm} — manual per-scanner RSSI trim
    # Sources masked out of positioning (issue #59). A MASK, never a delete:
    # stored calibration samples, positions and registry entries are untouched,
    # so removing a source from this list restores its influence exactly.
    "excluded_scanners": [],   # [source_name, ...] — ignored by every matcher
    # Devices masked at INGEST — they never become objects, so they cost no CPU,
    # no cache, no history. A MASK, never a delete: clear the list and the
    # device is back on the next poll with its history intact.
    #
    # excluded_objects is the simple form: stable identity keys, e.g.
    # "ibeacon:<uuid>:<major>:<minor>" — never a MAC, because the devices worth
    # masking are the ones whose MAC changes every second.
    "excluded_objects": [],
    # ingest_rules is the general form, for sites that cannot enumerate devices
    # by hand: [{action: mask|allow, reason: str,
    #            match: {keys: [], uuids: [], ouis: [], addrs: []}}]
    # First match wins, so an allow rule carves an exception out of a broad mask.
    "ingest_rules": [],
    "positioning_algorithm": "knn",    # "knn" | "rf" (Random Forest)
    "kalman_q": 0.125,             # Kalman process noise (RSSI responsiveness)
    "kalman_r": 8.0,               # Kalman measurement noise (smoothing strength)
    "assumed_device_height_m": 1.0,  # carry height above the floor for 3D distance (pocketed phone)
    "light_theme": False,   # invert the panel colours (accessibility — dark theme unusable for some)
    "light_shapes": {},     # entity_id -> marker shape; overrides the shape derived from the entity
    "lights_showcase": False,  # Mapping -> Lights: presentation rendering of the same map
    "lights_fit_rooms": False,  # Mapping -> Lights Showcase: never draw a fixture larger than its room
    "lights_hide_untouched": False,  # Mapping -> Lights: draw only fixtures that have been sized/rotated/coloured/shaped
    "overview_show_walls": False,   # Overview: draw RF barrier walls over the map
    "overview_show_outdoor": False, # Overview: draw outdoor areas (sheds, driveways) as an overlay
    "health_reminder_enabled": False,  # monthly calibration accuracy reminder (off by default)
    "health_reminder_last_ts":  None,  # epoch seconds when reminder was last shown
    "adaptive_learning_enabled": False,  # experimental: passive room fingerprint learning
    "adaptive_floor_detection": False,   # experimental: cross-floor attenuation learning
    "beacon_auto_calibrate": True,       # experimental: auto-inject calibration from pinned beacons
    "overview_persistent_pins": False,   # show away beacons at last known position on overview map
    # 3D isometric view layout (Maps tab)
    "maps_iso_floor_gap":    200,   # px spacing between floors
    "maps_iso_horiz_gap":    0,     # px L/R horizontal offset
    "maps_iso_focus":        None,  # z_level to highlight, or null = all
    # 3D isometric view layout (Overview tab)
    "overview_iso_floor_gap": 150,
    "overview_iso_horiz_gap": 0,
    "overview_iso_focus":     None,
    # Advanced-mode extra tabs (user picks from Settings → UI Structure)
    "advanced_extra_tabs": [],
    # HA entity publishing controls
    "ha_entity_tracker_enabled":          True,
    "ha_entity_area_enabled":             True,
    "ha_entity_distance_enabled":         True,
    "ha_entity_scanner_distance_enabled": True,
    # MQTT (experimental, off by default)
    "mqtt_publish_enabled": False,
    # ESPresense MQTT ingestion (off by default — requires HA MQTT integration)
    "espresense_mqtt_enabled": False,
    "espresense_topic_prefix": "espresense",
    "espresense_room_map": {},              # {"espresense_room": "HA Area Name"}
    # ESPresense Companion import (standalone .NET app / HA add-on)
    "espresense_companion_url": "",         # e.g. "http://espresense:8267" — empty = disabled
    # Aggressive BLE reseed for Shelly/passive proxies (off by default)
    # When enabled, reseeds from HA discovered-service-info every 5s instead of 30s.
    # Helps with HA 2026.4+ where habluetooth dedup suppresses repeat callbacks.
    "aggressive_ble_reseed": False,
    # Presence poll interval (seconds).  How often the smoothing pipeline runs.
    # Lower = faster room transitions but higher CPU.  Default 10s.
    "presence_poll_interval_s": 5,
    # BLE reseed interval (seconds).  How often bluetooth_live re-fetches from
    # HA's discovered-service-info API.  Essential for passive proxy scanners
    # (Shelly, etc.).  Overrides aggressive_ble_reseed when set.  Default 30s.
    "ble_reseed_interval_s": 30,
    # How long an object that was never identified is kept in object history.
    # Tagged/identified objects never expire regardless of this.  The whole
    # cache ships in every live_snapshot (polled every 5s), so longer windows
    # cost payload size and poll time: 7 days measured 16.4k objects / 19.5MB
    # / 2-7s per poll, 1 day 2.8k / 3.8MB / sub-second.  Allowed: 1, 2, 7, 14.
    "object_history_days": 1,
    # Lights sidebar panel (off by default — requires HA restart to take effect)
    "lights_panel_enabled": False,
    "ha_entity_occupancy_enabled": False,  # expose occupancy estimate sensors to HA
    "bermuda_ignore": False,  # experimental: ignore all Bermuda integration data
    # HA Tags integration
    "tags_room_events_enabled": False,     # emit tag_scanned on room changes
    "tags_nfc_identify_enabled": False,    # NFC tap-to-identify BLE objects
    "tags_phone_autolink_enabled": False,  # auto-track phone on NFC scan
    # Quiet mode — hide unidentified objects everywhere
    "quiet_mode": False,
    # Experimental: 2D flat map mode (replaces 3D isometric view)
    "overview_2d_mode": False,
    # Followed BLE addresses (uppercase MAC/key strings)
    "followed_addrs": [],
    # Beacon profiling / characteristics
    "beacon_profiling_enabled": True,     # master toggle for beacon profiling feature
    "beacon_tune_disabled": [],           # device_ids excluded from calibration tuning
    "beacon_group_overrides": {},         # device_id → model_key override (ungroup/regroup)
    # Private BLE IRK devices (managed in PadSpan — no separate integration needed)
    "irk_devices": [],                    # [{name: str, irk_hex: str}]
    # Curated room → object map (room name → list of object keys).  Set via the
    # padspan_ha.set_room_tag_map service / Manage UI.  Persisted here so it
    # survives restarts and integration reloads — previously the coordinator's
    # room_tag_map was in-memory only and reset to {} on every restart.
    "room_tag_map": {},                   # {room_name: [object_key, ...]}
    # ── Forensics (off by default — records presence sessions of ALL nearby
    # BLE devices, including neighbours/passers-by, for time-window queries.
    # Privacy-sensitive: user must opt in via Settings → Features.) ──────────
    "forensics_enabled": False,
    "forensics_retention_days": 14,       # allowed: 7, 14, 30, 60, 90
    # PadSpan Pro licence (validated against traks.ca/license, product=padspan).
    # Set only via the padspan_ha/forensics_license_activate command.
    "forensics_license_key": "",
    "forensics_license_expires": "",
    # ── Enterprise preview features (off by default) ─────────────────────────
    "trackability_rating_enabled": False,   # per-device Easy/Medium/Hard trackability score
    "walk_to_identify_enabled": False,      # spatial correlation device discovery ("who just walked in?")
    "radio_map_enabled": False,             # RSSI heatmap overlay on floor plan maps
    "distortion_map_enabled": False,        # calibration disagreement visualization
    "compass_ring_enabled": False,          # structured rotate-in-place calibration protocol
    "replay_timeline_enabled": False,       # movement replay with scoring explainability
    # ── RSSI vector capture (off by default) ─────────────────────────────────
    # Records the full per-scanner RSSI vector for tracked objects, plus the
    # room the pipeline chose, so a trace can be replayed offline against
    # changed code.  Session-scoped: nothing is written until an operator
    # starts a recording, and a session is capped at 60 minutes and 25 MB.
    "rssi_capture_enabled": False,
    "rssi_capture_retention_days": 14,      # allowed: 1, 3, 7, 14, 30
}


@dataclass
class SettingsStore:
    hass: HomeAssistant
    store: Store
    data: dict[str, Any]

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._raw_store = Store(hass, 1, SETTINGS_STORE_KEY)
        from .safe_store import wrap_store
        self.store = wrap_store(self._raw_store, hass, "settings")
        self.data = dict(DEFAULT_SETTINGS)

    async def async_load(self) -> dict[str, Any]:
        """Load and merge persisted settings onto defaults.

        Merging ensures new keys added in future versions get their defaults
        while preserving the user's existing overrides.
        """
        loaded = await self.store.async_load()
        if isinstance(loaded, dict):
            self.data = {**DEFAULT_SETTINGS, **loaded}
        else:
            self.data = dict(DEFAULT_SETTINGS)
        # Normalize followed_addrs: uppercase + dedup (order preserved).
        # Every comparison in the system (frontend followedHas, backend
        # settings_set, tag_integration) is uppercase; historic entries were
        # saved in mixed formats and silently failed to match.
        _normalized = False
        try:
            _fa = self.data.get("followed_addrs") or []
            _seen: set[str] = set()
            _norm: list[str] = []
            for _x in _fa:
                if not isinstance(_x, str):
                    continue
                _u = _x.strip().upper()
                if _u and _u not in _seen:
                    _seen.add(_u)
                    _norm.append(_u)
            if _norm != _fa:
                self.data["followed_addrs"] = _norm
                _normalized = True
        except Exception:
            pass
        # Only re-save if new defaults were added (loaded was missing keys)
        if _normalized or not isinstance(loaded, dict) or set(self.data.keys()) != set(loaded.keys()):
            await self.store.async_save(self.data)
        return self.data

    async def async_set(self, **kwargs: Any) -> dict[str, Any]:
        self.data = {**self.data, **kwargs}
        await self.store.async_save(self.data)
        return self.data

    def get(self, key: str, default: Any = None) -> Any:
        return self.data.get(key, default)
