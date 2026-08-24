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
  3. BLE signal-processing defaults (ref power, path-loss, Kalman)
  4. hass.data slot names (DATA_*)
  5. HA Storage file keys (*_STORE_KEY) — each maps to a file under .storage/
  6. Filesystem paths (MAPS_DIR)
"""

DOMAIN = "padspan_ha"
NAME = "PadSpan HA"
VERSION = "0.37.1"

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

# ── hass.data slot names (keys into hass.data[DOMAIN]) ───────────────────────
DATA_COORDINATOR = "coordinator"
DATA_PANEL_REGISTERED = "_panel_registered"    # flag to avoid re-registering the panel
DATA_SETTINGS = "settings"
DATA_MAPS = "maps"
DATA_MODEL = "model"
DATA_OBJECTS = "objects"
DATA_OBJECTS_CACHE = "objects_cache"            # in-memory enrichment cache (not persisted)
# Which MAC addresses each beacon identity showed on the PREVIOUS poll.
# Telling one rotating beacon from several identical ones needs one poll of
# memory — a pack keeps advertising the same addresses, a rotator abandons
# each address after using it. In-memory only: it is worth nothing after a
# restart, and the decision falls back to address heuristics until the second
# poll rebuilds it. See beacon_identity.decide_split().
DATA_BEACON_LAST_MACS = "beacon_last_macs"
DATA_CALIBRATION = "calibration"
DATA_ALERTS = "alerts"
DATA_MOVEMENT = "movement"
DATA_ADAPTIVE = "adaptive"
DATA_OBJECT_HISTORY = "object_history"
DATA_TRACEBACK = "traceback"
DATA_TAG_INTEGRATION = "tag_integration"
DATA_FABRIC = "fabric"                       # FabricStore — room-geometry ground truth
DATA_DEVICE_REGISTRY = "device_registry"     # stable device identity registry
DATA_ESPRESENSE_MQTT = "espresense_mqtt"     # ESPresense MQTT ingestion module
DATA_FORENSICS = "forensics"                 # presence-session recorder (opt-in)
DATA_CAPTURE = "capture"                     # RSSI vector session recorder (opt-in)

# ── HA Storage file keys (.storage/<key>) ─────────────────────────────────────
SETTINGS_STORE_KEY = "padspan_ha.settings"
MAPS_STORE_KEY = "padspan_ha.maps"
MODEL_STORE_KEY = "padspan_ha.model"
FABRIC_STORE_KEY = "padspan_ha.fabric"
OBJECT_STORE_KEY = "padspan_ha.objects"
CALIBRATION_STORE_KEY = "padspan_ha.calibration"
ALERTS_STORE_KEY = "padspan_ha.follow_alerts"
MOVEMENT_STORE_KEY = "padspan_ha.movement_history"
ADAPTIVE_STORE_KEY = "padspan_ha.adaptive"
BACKUPS_STORE_KEY = "padspan_ha.backups"
OBJECT_HISTORY_STORE_KEY = "padspan_ha.object_history"
VENDOR_CACHE_STORE_KEY = "padspan_ha.vendor_cache"
TRACEBACK_STORE_KEY = "padspan_ha.traceback"
FORENSICS_STORE_KEY = "padspan_ha.forensics"
# Manifest only — session frames live in .storage/padspan_ha.capture_sessions/
CAPTURE_STORE_KEY = "padspan_ha.capture"

# ── Filesystem / map defaults ─────────────────────────────────────────────────
DEFAULT_FLOOR_ID = "main"
OUTSIDE_FLOOR_ID = "__outside__"               # synthetic floor for outdoor / unassigned scanners
DEFAULT_ROOM_RADIUS = 0.12                     # normalised (0–1) fallback radius around a receiver
MAPS_DIR = "padspan_ha/maps"                   # relative to HA www/ dir → /local/padspan_ha/maps/

# Upper bound for any single vertical measurement: scanner mounting height,
# floor-to-floor, ceiling height.  It exists to catch a typo (a metre value
# entered as centimetres), NOT to describe a building — high-bay warehouse and
# atrium levels genuinely exceed 20 m, and clamping one silently corrupts every
# derived base elevation stacked above it.  One place, so raising it later is a
# single edit rather than a hunt through both stores and the frontend.
MAX_HEIGHT_M = 100.0

# ── Phase 2: real-world coordinate defaults ──────────────────────────────
DEFAULT_VG_ADJACENT_M = 8.0                    # metres — velocity gate adjacency threshold
DEFAULT_ADJACENCY_SIGMOID_M = 8.0              # metres — adjacency prior sigmoid midpoint

# ── Calibration grading thresholds (metres of LOO mean error) ────────────────
# These were fractions of a floor plan image, which only meant a distance if
# you assumed the plan was 15 m wide. They are that same assumption resolved
# once: a 15 m house grades exactly as it did, every other building now grades
# on its actual error instead of on its image proportions.
GRADE_A_ERROR_M = 0.75
GRADE_B_ERROR_M = 1.2
GRADE_C_ERROR_M = 1.8
GRADE_NO_DATA_ERROR_M = 15.0                   # "no accuracy data" sentinel — fails every grade
CRITIC_CRITICAL_ERROR_M = 2.25
CRITIC_WARNING_ERROR_M = 1.2

# ── Light marker shapes ─────────────────────────────────────────────────────
# The one backend copy of LIGHT_SHAPES in www/padspan-ha/views/light_codes.js —
# the reflected-ceiling-plan symbols the renderer draws. Placement (fabric,
# model_store) and the per-entity override (settings.light_shapes) both
# validate against this; tests/test_lights_renderer.py holds it equal to the
# chooser. "auto" means "derive from the entity" and is a valid placement
# shape but not an override (an override that says auto is simply absent).
LIGHT_SHAPE_KINDS = frozenset({
    "hex", "circle", "bar", "line", "square", "triangle", "diamond",
    "fan", "sconce", "pendant", "chandelier",
})

# ── Outdoors ────────────────────────────────────────────────────────────────
# What "the outdoor floor" is called: the fabric's sentinel and the names a
# registry floor is usually given. One list — the model store ranks these at
# ground level and the outside-attribution rule reads the same list.
OUTDOOR_FLOOR_NAMES = frozenset({
    OUTSIDE_FLOOR_ID, "outside", "outdoor", "outdoors", "exterior", "garden", "yard",
})
