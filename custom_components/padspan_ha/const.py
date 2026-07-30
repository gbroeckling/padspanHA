# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""
PadSpan HA — Constants & Configuration Keys
=============================================
Central registry for domain name, config keys, default tuning parameters,
persistent-store keys, and hass.data slot names.

Organisation:
  1. Identity (DOMAIN, NAME, VERSION)
  2. Config-flow options (CONF_*)
  3. BLE signal-processing defaults (ref power, path-loss, Kalman, Gaussian sigma)
  4. hass.data slot names (DATA_*)
  5. HA Storage file keys (*_STORE_KEY) — each maps to a file under .storage/
  6. Filesystem paths (MAPS_DIR)
"""

DOMAIN = "padspan_ha"
NAME = "PadSpan HA"
VERSION = "0.21.7"

# ── Config-flow option keys ───────────────────────────────────────────────────
CONF_ENABLE_CLOUD = "enable_cloud"
CONF_HUB_URL = "hub_url"
CONF_API_KEY = "api_key"
CONF_SCAN_INTERVAL = "scan_interval"

# ── BLE signal-processing defaults ────────────────────────────────────────────
DEFAULT_SCAN_INTERVAL = 30
DEFAULT_REF_POWER = -59.0        # dBm RSSI at 1 m (typical BLE beacon)
DEFAULT_PATH_LOSS_EXP = 2.5      # path-loss exponent n (free-space = 2.0, indoor = 2.5–4.0)

# Kalman filter parameters for per-scanner RSSI smoothing (replaces EMA).
# Q = process noise: how fast the true RSSI is expected to change between polls.
# R = measurement noise: how noisy each raw RSSI reading is.
DEFAULT_KALMAN_Q = 0.125
DEFAULT_KALMAN_R = 8.0

# Gaussian room-scoring σ in metres.  score = exp(−(d/σ)²)
# At d=σ the scanner's influence drops to ~37%; at d=2σ to ~2%.
DEFAULT_ROOM_SIGMA_M = 4.0

# ── hass.data slot names (keys into hass.data[DOMAIN]) ───────────────────────
DATA_COORDINATOR = "coordinator"
DATA_PANEL_REGISTERED = "_panel_registered"    # flag to avoid re-registering the panel
DATA_SETTINGS = "settings"
DATA_MAPS = "maps"
DATA_MODEL = "model"
DATA_OBJECTS = "objects"
DATA_OBJECTS_CACHE = "objects_cache"            # in-memory enrichment cache (not persisted)
DATA_CALIBRATION = "calibration"
DATA_ALERTS = "alerts"
DATA_MOVEMENT = "movement"
DATA_ADAPTIVE = "adaptive"
DATA_OBJECT_HISTORY = "object_history"
DATA_TRACEBACK = "traceback"
DATA_TAG_INTEGRATION = "tag_integration"
DATA_FABRIC = "fabric"                       # positioning fabric (Phase 1 decoupling)
DATA_DEVICE_REGISTRY = "device_registry"     # stable device identity registry
DATA_ESPRESENSE_MQTT = "espresense_mqtt"     # ESPresense MQTT ingestion module

# ── HA Storage file keys (.storage/<key>) ─────────────────────────────────────
SETTINGS_STORE_KEY = "padspan_ha.settings"
MAPS_STORE_KEY = "padspan_ha.maps"
MODEL_STORE_KEY = "padspan_ha.model"
OBJECT_STORE_KEY = "padspan_ha.objects"
CALIBRATION_STORE_KEY = "padspan_ha.calibration"
ALERTS_STORE_KEY = "padspan_ha.follow_alerts"
MOVEMENT_STORE_KEY = "padspan_ha.movement_history"
ADAPTIVE_STORE_KEY = "padspan_ha.adaptive"
BACKUPS_STORE_KEY = "padspan_ha.backups"
OBJECT_HISTORY_STORE_KEY = "padspan_ha.object_history"
VENDOR_CACHE_STORE_KEY = "padspan_ha.vendor_cache"
TRACEBACK_STORE_KEY = "padspan_ha.traceback"

# ── Filesystem / map defaults ─────────────────────────────────────────────────
DEFAULT_FLOOR_ID = "main"
OUTSIDE_FLOOR_ID = "__outside__"               # synthetic floor for outdoor / unassigned scanners
DEFAULT_ROOM_RADIUS = 0.12                     # normalised (0–1) fallback radius around a receiver
MAPS_DIR = "padspan_ha/maps"                   # relative to HA www/ dir → /local/padspan_ha/maps/

# ── Phase 2: real-world coordinate defaults ──────────────────────────────
DEFAULT_VG_ADJACENT_M = 8.0                    # metres — velocity gate adjacency threshold
DEFAULT_ADJACENCY_SIGMOID_M = 8.0              # metres — adjacency prior sigmoid midpoint
