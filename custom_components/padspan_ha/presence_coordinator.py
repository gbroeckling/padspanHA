# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""
PadSpan HA — Presence Coordinator
===================================
A DataUpdateCoordinator that polls the live snapshot and provides
{key: object_dict} data to sensor and device_tracker entities.

SMOOTHING PIPELINE (BLE objects only)
──────────────────────────────────────
Raw BLE RSSI is extremely noisy — a device standing still can swing ±10 dBm
between consecutive advertisements.  Without smoothing, the "current room" flickers
between adjacent rooms every few seconds.

Three-stage pipeline applied each poll cycle:

  Stage 1 — Kalman-filtered RSSI per source
    Replaces the fixed-alpha EMA with an adaptive Kalman filter that adjusts
    its gain based on estimated uncertainty.  This makes the filter more
    responsive to genuine movement while still rejecting momentary RF spikes.

    Kalman update per (device, scanner) pair:
        K = P / (P + R)                  # Kalman gain
        x = x + K * (rssi_raw - x)       # filtered estimate
        P = (1 - K) * P + Q              # error covariance

    Q (process noise) — how much the true RSSI is expected to vary per poll.
      Default 0.125.  Increase for faster response; decrease for more smoothing.
    R (measurement noise) — how noisy the raw measurement is.
      Default 8.0.  Increase for more smoothing; decrease for faster response.

    Sources that stop reporting are decayed toward -100 dBm and pruned when they
    fall below -95 dBm (~4–5 polls after last seen).

  Stage 1.5 — Gaussian room scoring (replaces winner-takes-all max RSSI)
    Each scanner's Kalman RSSI is converted to an estimated distance via the
    path-loss formula, then scored with a Gaussian weight exp(−(d/σ)²) where
    σ is the configurable room_sigma_m (default 4 m).  The room with the highest
    max-score across its assigned scanners becomes the candidate.  This penalises
    scanners on the far side of a wall more proportionally than raw RSSI comparison.

    Optional k-NN override: if calibration fingerprint data (≥5 points) exists and
    the k-NN confidence exceeds 0.30, the fingerprint result replaces the Gaussian
    candidate.  Also provides sub-room (x_frac, y_frac) for map dot positioning.

  Stage 2 — Majority-vote window
    At each poll, the candidate room (from Gaussian scoring or k-NN) is added to
    a rolling window of VOTE_WINDOW (5) entries.  The confirmed room only changes
    when one room appears ≥ VOTE_THRESHOLD (3) times in the window.
    At 10 s/poll this means a room switch requires ~30 s of consistent dominance.

    The vote window is cleared when a device re-appears after being away, preventing
    stale votes from the previous location from influencing re-entry assignment.

HOME/AWAY PERSISTENCE
─────────────────────
Devices that disappear from the live snapshot are kept in the result dict with a
synthetic age_s that grows each poll.  A 2-poll grace period (≈20 s) prevents a
momentary signal gap from triggering an away event.  Devices with confident
presence (room_confidence ≥ 0.6) get an extended grace period controlled by the
signal_loss_linger_s setting (default 90 s / ~9 polls) so that brief BLE dropouts
don't erase established presence.  Entities read age_s and return "not_home" when
it exceeds the configured away timeout (Settings → Presence → Away timeout;
default 300 s / 5 min).  Entities never go "unavailable" — "not_home" is a
permanently valid HA state.

When ALL scanners go silent simultaneously (total signal dropout), the Kalman
filter decays toward -95 dBm instead of -100 dBm, preserving state ~3× longer
(~200-250 s vs ~70-80 s).  When some scanners are still active (genuine movement),
losing scanners still decay rapidly at -100 dBm for fast room switching.  The vote
window also skips None candidates during total silence, preserving the last
confirmed room assignment.

CONFIDENCE SCORE
─────────────────
Each poll computes room_confidence ∈ [0, 1] based on how decisive the vote window is:
    confidence = top_room_vote_count / vote_window_size
At 1.0 the device has been in the same room for every poll in the window.
At 0.33 (with window=3) only one poll agreed.  Surface in automations via the
extra_state_attributes of sensor.{device}_area.
"""
from __future__ import annotations

import logging
import math
import os
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from typing import Any

import voluptuous as vol
from homeassistant.core import HomeAssistant
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
)
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import (
    DOMAIN, DATA_SETTINGS, DATA_CALIBRATION, DATA_ADAPTIVE, DATA_MODEL,
    DATA_OBJECTS, DATA_CAPTURE, OUTSIDE_FLOOR_ID,
    DEFAULT_KALMAN_Q, DEFAULT_KALMAN_R,
    DEFAULT_REF_POWER, DEFAULT_PATH_LOSS_EXP, DEFAULT_ROOM_SIGMA_M,
)

_LOGGER = logging.getLogger(__name__)

_SCAN_INTERVAL = timedelta(seconds=10)

# ── Kalman / smoothing constants ─────────────────────────────────────────────
# Defaults — overridable via Settings → Presence → Signal Filter
_KALMAN_Q: float = DEFAULT_KALMAN_Q   # process noise
_KALMAN_R: float = DEFAULT_KALMAN_R   # measurement noise

# Rolling window for majority-vote room confirmation.
# Candidate room must win VOTE_THRESHOLD out of the last VOTE_WINDOW polls.
# At 10s/poll, window=5 means a room switch needs ~30s of consistent dominance.
_VOTE_WINDOW: int = 5
_VOTE_THRESHOLD: int = 3

# ── Floor selection ──────────────────────────────────────────────────────────
# A floor decision needs the same temporal discipline the other two stages
# already have: RSSI will not decay before _SILENCE_GRACE consecutive misses,
# and a room will not change before it wins the vote window. Floor selection
# had neither — it was recomputed from scratch every poll and compared on equal
# terms whether fifteen scanners had reported or two.
#
# All three numbers are in the same currency (dB of RSSI) and belong together,
# because a change of one without the others is what makes a floor either
# jittery or stuck.
_FLOOR_STICKY_DB: float = 4.0    # head start the currently-confirmed floor gets
_FLOOR_SWITCH_DB: float = 2.0    # margin a challenger needs BEYOND that head start
# How much of its USUAL evidence a device must hear before a floor CHANGE is
# allowed. Not an absolute count: a first attempt used one, and it was dead
# code — floor selection is only reached when at least three positioned
# scanners reported, so a floor of three could never bind. The quantity that
# actually distinguishes a gap from a move is RELATIVE. A device that normally
# hears twelve scanners and hears four this poll is in a gap; a device that
# only ever hears four is not, and must not be frozen for it.
_FLOOR_EVIDENCE_FRACTION: float = 0.5
# How fast that per-device expectation forgets. It rises to a new high at once
# and decays slowly, so one collapsed poll cannot drag the baseline down and
# re-open the very gap this exists to close, while a scanner genuinely removed
# from the house is adapted to within a minute or two.
_FLOOR_EVIDENCE_DECAY: float = 0.98

# ── Position plausibility ────────────────────────────────────────────────────
# The apparent speed a position step would imply, above which the step is
# treated as a bad measurement rather than as movement. Twice the α-β filter's
# 2.5 m/s walk clamp: the aim is to reject the impossible, not to argue with
# someone moving quickly, and a device in a car is genuinely fast.
_XY_JUMP_SPEED_MS: float = 5.0
# Consecutive rejections before an implausible position is believed anyway.
# A device switched off and carried elsewhere really does teleport, so the
# gate has to be stubborn, not immovable — the same shape as _SILENCE_GRACE.
_XY_JUMP_TOLERATE: int = 3

# RSSI threshold below which a silent source is pruned from the Kalman cache.
# Relaxed from -95 to -98 to preserve Kalman state longer across silent periods,
# giving ~7-8 polls (~70-80s) of memory instead of ~4-5 polls.
_EMA_PRUNE_DBM: float = -98.0

# Phantom RSSI injected each poll for sources that have gone silent (drives decay).
_EMA_SILENCE_DBM: float = -100.0

# Number of consecutive missed polls before a device starts accumulating age_s.
# Away grace is expressed in SECONDS and converted to polls at runtime —
# poll-count constants would silently retune whenever the user changes
# presence_poll_interval_s (e.g. 12 polls = 2 min at 10 s but 12 min at 60 s).
_AWAY_GRACE_S: float = 120.0

# ── Velocity gate ────────────────────────────────────────────────────────────
# Prevents "teleportation" — objects jumping to non-adjacent rooms faster than
# physically possible.  After a room change is confirmed, any subsequent change
# within the cooldown window requires UNANIMOUS vote agreement (all votes must
# agree) instead of the normal majority threshold.  This makes it progressively
# harder to hop rooms in rapid succession.
#
# The distance component uses room centroids: distant rooms (centroid distance
# > _VG_ADJACENT_THRESHOLD in normalised [0,1] coords) also require unanimous
# agreement regardless of timing.  This catches slow-drift teleportation where
# a device creeps across the building over 30+ seconds without passing through
# intermediate rooms.
_VG_RAPID_COOLDOWN_S: float = 15.0    # seconds after a room change during which the next change is gated
_VG_ADJACENT_THRESHOLD: float = 0.30  # normalised centroid distance — rooms within this are "adjacent"
_VG_ADJACENT_THRESHOLD_M: float = 8.0  # metres — Phase 2 real-world adjacency threshold
_ADJACENCY_SIGMOID_MID_M: float = 8.0  # metres — Phase 2 adjacency prior sigmoid midpoint

# ── Outdoor / isolated scanner penalties ─────────────────────────────────
_OUTDOOR_SCORE_DAMPING: float = 0.30  # multiply outdoor room scores by this when device is indoors
_ISOLATED_SCANNER_DAMPING: float = 0.50  # damping for scanners that are the only one on their floor
_ISOLATED_SCANNER_STRONG_DBM: float = -65.0  # RSSI above this = strong enough to override isolation damping

# ── Per-scanner reliability scoring (Phase 3) ────────────────────────────────
# Each scanner accumulates a rolling "disagreement" count — how often its best
# RSSI implies a different room than the consensus (confirmed room).
# reliability = 1 / (1 + disagreement_rate)  where rate ∈ [0, 1].
# Used as a weight multiplier on each scanner's Gaussian score.
_RELIABILITY_WINDOW: int = 30         # rolling window size (polls)
_RELIABILITY_MIN_POLLS: int = 6       # min observations before weight differs from 1.0
_RELIABILITY_FLOOR: float = 0.15      # minimum weight — never zero-out a scanner entirely

# ── k-NN live fingerprint gating ─────────────────────────────────────────────
# Minimum calibration points before k-NN is consulted for live room assignment.
_KNN_MIN_POINTS: int = 5
# Minimum k-NN confidence [0, 1] required to override the Gaussian candidate.
# With the normalized confidence formula (mean-sq-error / REF_VARIANCE), a
# per-scanner RMS error of ~8 dBm gives ~28% confidence, ~5 dBm gives ~50%.
_KNN_LIVE_THRESHOLD: float = 0.15


# _room_centroids_from_maps and _room_from_bounds removed.
# Fabric is the sole authority: model.room_centroids_m() and model.beacon_room_from_geometry().


def _segments_intersect(
    ax: float, ay: float, bx: float, by: float,
    cx: float, cy: float, dx: float, dy: float,
) -> bool:
    """Return True if segment AB crosses segment CD."""
    def _cross(o1x: float, o1y: float, o2x: float, o2y: float, o3x: float, o3y: float) -> float:
        return (o2x - o1x) * (o3y - o1y) - (o2y - o1y) * (o3x - o1x)
    d1 = _cross(cx, cy, dx, dy, ax, ay)
    d2 = _cross(cx, cy, dx, dy, bx, by)
    d3 = _cross(ax, ay, bx, by, cx, cy)
    d4 = _cross(ax, ay, bx, by, dx, dy)
    if ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0)) and \
       ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0)):
        return True
    return False


def _barrier_attenuation(
    sx: float, sy: float, s_floor: str,
    rx: float, ry: float, r_floor: str,
    barriers: list[dict],
) -> float:
    """Compute total RF attenuation (dBm) for barriers crossing the line from
    point (sx,sy) to point (rx,ry). Only considers barriers on the same floor."""
    total = 0.0
    for bar in barriers:
        _bar_floor = bar.get("floor_id") or bar.get("map_id", "")
        if _bar_floor != s_floor:
            continue
        pts = bar["points"]
        for i in range(len(pts) - 1):
            if _segments_intersect(sx, sy, rx, ry, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]):
                total += bar["attenuation_dbm"]
                break  # one crossing per barrier is enough
    return total


_MIN_RANGE_CAP_M = 50.0

# How far past the fabric's own room extent a solved position may sit before
# it stops being a position and becomes a solver artifact.  Covers wall
# thickness, doorways and approximate geometry — not 6 m into the garden.
_SITE_MARGIN_M = 3.0


def _site_range_cap(positions: dict[str, tuple[float, float, str]]) -> float:
    """Largest distance a single RSSI reading may claim, scaled to the site.

    The cap stops a noise-floor reading handing the solver a distance the
    building could never contain.  It has to follow the site: a house spans
    ~15 m, while one 100,000 m² commercial floor spans ~450 m corner to
    corner, and a fixed ceiling would flatten every genuinely distant scanner
    onto the same weight.

    Twice the scanner bounding-box diagonal, never below the historic 50 m —
    so every domestic install keeps exactly the behaviour it has today.
    """
    if not positions:
        return _MIN_RANGE_CAP_M
    xs = [p[0] for p in positions.values()]
    ys = [p[1] for p in positions.values()]
    diagonal = math.hypot(max(xs) - min(xs), max(ys) - min(ys))
    return max(_MIN_RANGE_CAP_M, 2.0 * diagonal)


def _slant_to_horizontal(d_slant: float, dz: float) -> float:
    """Project an RSSI slant range onto the horizontal plane (issue #54).

    d_h = sqrt(d² − dz²).  When the slant reading is shorter than the known
    vertical offset (measurement noise, or the device is directly under a
    ceiling scanner), the horizontal distance is ~0 — return a small floor
    rather than a complex number.  dz=0 is the exact 2D legacy behaviour.

    The projection is only half the story: a small d_h is also a *poorly
    determined* d_h.  See _range_weight, which carries that uncertainty into
    the solve so a near-vertical reading cannot outvote an honest one.
    """
    if not dz:
        return d_slant
    under = d_slant * d_slant - dz * dz
    return math.sqrt(under) if under > 0.09 else 0.3


def _range_weight(d_h: float, d_slant: float) -> float:
    """Least-squares weight (1/σ²) for one horizontal range estimate.

    RSSI ranging error is multiplicative — σ_d ∝ d — which is why near
    receivers are more reliable and the solve has always weighted by 1/d².
    Projecting to the horizontal plane amplifies that error by
    ∂d_h/∂d = d/d_h, so σ_h ∝ d²/d_h and the weight is d_h²/d⁴.

    For a same-floor scanner (d_h == d_slant) this reduces to exactly the
    legacy 1/d², so flat installs keep the behaviour they have today.  For a
    scanner nearly overhead or on another floor, d_h is a small difference of
    two large numbers: weighting by 1/d_h² handed those least-determined
    readings the *most* authority, and one hot cross-floor reading could
    outvote every honest scanner and snap the estimate onto its coordinates —
    routinely outside the building, and only on the polls where noise pushed
    that reading below its own vertical offset.
    """
    _d2 = max(d_slant * d_slant, 1e-6)
    # Written as d²·(d²+0.01) rather than d⁴ so that d_h == d_slant collapses
    # to the legacy 1/(d²+0.01) exactly, epsilon included.
    return (d_h * d_h) / (_d2 * (_d2 + 0.01))


def _wls_refine(
    x0: float, y0: float, meas: list[tuple[float, float, float]], iters: int = 3
) -> tuple[float, float]:
    """Refine a position estimate via weighted-least-squares multilateration.

    meas: [(scanner_x, scanner_y, estimated_distance_m, weight)].  Runs
    Gauss-Newton iterations minimizing Σ wᵢ(‖x−pᵢ‖ − dᵢ)², with the weights
    supplied by _range_weight so a poorly-determined horizontal range cannot
    dominate.  Seeded at (x0, y0), typically the IDW centroid — unlike the
    centroid, the solution CAN sit between or outside the receivers.

    Damped (max 5 m movement per iteration) and conservative: on singular
    geometry (collinear receivers), non-finite results, or a refinement that
    fits the ranges WORSE than the seed did, returns the seed.
    """
    def _cost(px: float, py: float) -> float:
        return sum(
            w * (math.hypot(px - sx, py - sy) - d) ** 2 for sx, sy, d, w in meas
        )

    x, y = x0, y0
    for _ in range(iters):
        a11 = a12 = a22 = b1 = b2 = 0.0
        for sx, sy, d, w in meas:
            dx = x - sx
            dy = y - sy
            r = math.hypot(dx, dy)
            if r < 1e-6:
                continue
            ux = dx / r
            uy = dy / r
            resid = r - d
            a11 += w * ux * ux
            a12 += w * ux * uy
            a22 += w * uy * uy
            b1 += w * ux * resid
            b2 += w * uy * resid
        det = a11 * a22 - a12 * a12
        if abs(det) < 1e-9:
            break
        step_x = (a22 * b1 - a12 * b2) / det
        step_y = (a11 * b2 - a12 * b1) / det
        mag = math.hypot(step_x, step_y)
        if mag > 5.0:
            step_x *= 5.0 / mag
            step_y *= 5.0 / mag
        x -= step_x
        y -= step_y
        if mag < 0.05:
            break
    if not (math.isfinite(x) and math.isfinite(y)):
        return x0, y0
    # Gauss-Newton takes the full step regardless of whether it helps.  On
    # mutually inconsistent ranges — the normal state of BLE RSSI — that can
    # walk the estimate away from the seed while fitting the data no better.
    if _cost(x, y) > _cost(x0, y0):
        return x0, y0
    return x, y


def _floor_bounds_from_geometry(
    room_geometry: dict[str, Any],
) -> dict[str, tuple[float, float, float, float]]:
    """Per-floor (min_x, max_x, min_y, max_y) of the fabric's room polygons.

    This is the building's own extent, straight from the metric fabric — the
    only thing that knows how far the structure actually reaches.
    """
    bounds: dict[str, list[float]] = {}
    for geo in (room_geometry or {}).values():
        if not isinstance(geo, dict):
            continue
        fl = str(geo.get("floor_id", "") or "")
        pts: list[tuple[float, float]] = []
        if geo.get("type") == "circle":
            try:
                cx = float(geo.get("cx_m", 0))
                cy = float(geo.get("cy_m", 0))
                r = abs(float(geo.get("r_m", 0)))
            except (TypeError, ValueError):
                continue
            pts = [(cx - r, cy - r), (cx + r, cy + r)]
        else:
            for p in (geo.get("points_m") or []):
                try:
                    pts.append((float(p[0]), float(p[1])))
                except (TypeError, ValueError, IndexError):
                    continue
        if not pts:
            continue
        b = bounds.get(fl)
        for px, py in pts:
            if b is None:
                b = [px, px, py, py]
                bounds[fl] = b
            else:
                if px < b[0]:
                    b[0] = px
                if px > b[1]:
                    b[1] = px
                if py < b[2]:
                    b[2] = py
                if py > b[3]:
                    b[3] = py
    return {f: (b[0], b[1], b[2], b[3]) for f, b in bounds.items()}


def _within_floor_bounds(
    x: float,
    y: float,
    floor_id: str,
    bounds: dict[str, tuple[float, float, float, float]],
    margin: float = _SITE_MARGIN_M,
) -> bool:
    """Is this estimate inside the floor's own extent, plus a margin?

    A floor with no geometry cannot judge, so it accepts — never let a missing
    polygon suppress a position.
    """
    b = bounds.get(str(floor_id or ""))
    if not b:
        return True
    return (b[0] - margin) <= x <= (b[1] + margin) and (b[2] - margin) <= y <= (b[3] + margin)


class PresenceCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Central BLE room-presence engine for PadSpan HA.

    Polls the live BLE snapshot every 10 seconds and runs each advertisement
    through a multi-stage pipeline:
        1. Kalman filter (per-scanner RSSI smoothing)
        2. Gaussian room scoring (distance-weighted room assignment)
        3. Majority-vote window (temporal stabilization)

    The result dict maps object keys to enriched dicts containing the
    confirmed room, confidence scores, and optional k-NN sub-room position.
    Sensor and device_tracker entities consume this via HA's coordinator
    pattern (async_config_entry_first_refresh / async_add_listener).
    """

    def __init__(self, hass: HomeAssistant) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name="PadSpan HA Presence",
            update_interval=_SCAN_INTERVAL,
        )
        # ── CPU mode (settings: cpu_mode = shared|single|dedicated) ─────────
        # single/dedicated run the per-object smoothing loop on this one-thread
        # executor so HA's event loop stays responsive; dedicated additionally
        # pins that thread to one core (Linux sched_setaffinity).
        self._compute_executor: ThreadPoolExecutor | None = None
        self._compute_executor_mode: str | None = None
        # ── home/away persistence ────────────────────────────────────────────
        # {key: monotonic_ts}  — when each object was last in the live snapshot
        self._last_seen: dict[str, float] = {}
        # {key: obj_dict}  — most recent live copy of each object
        self._known_objs: dict[str, dict[str, Any]] = {}
        # {key: int}  — consecutive polls the object has been absent
        self._away_miss: dict[str, int] = {}

        # ── Kalman smoothing state (keyed by addr/key) ───────────────────────
        # {addr: {source: filtered_rssi}}  — Kalman state estimate x
        self._ema_rssi: dict[str, dict[str, float]] = {}
        # {addr: {source: error_covariance}}  — Kalman state P
        self._kalman_p: dict[str, dict[str, float]] = {}
        # {addr: {source: consecutive_miss_count}} — silence grace tracking
        self._silence_miss: dict[str, dict[str, int]] = {}
        # Sources masked out of positioning (issue #59), read from settings.
        self._excluded_cache: frozenset[str] = frozenset()
        # {key: addr} — object key → Kalman state key (RPA-resolved address
        # for ble/private_ble).  Lets _evict_object clean the address-keyed
        # Kalman dicts above, which are NOT keyed by object key.
        self._kalman_addr_key: dict[str, str] = {}

        # ── Room-vote state (keyed by object key) ────────────────────────────
        # {key: deque of recent candidate rooms}
        self._room_votes: dict[str, deque] = {}
        # {key: confirmed_room | None}  — the current stable room assignment
        self._confirmed_room: dict[str, str | None] = {}
        # {key: float}  — vote-window confidence ∈ [0, 1]
        self._room_confidence: dict[str, float] = {}
        # {key: float}  — RSSI margin confidence ∈ [0, 1] (gap between best and 2nd-best scanner)
        self._rssi_margin_confidence: dict[str, float] = {}
        # {key: dict}  — latest k-NN fingerprint result (x_frac, y_frac, confidence, nearest_room)
        self._knn_position: dict[str, dict] = {}
        # {key: (x, y)}  — EMA-smoothed position for k-NN (stable map display)
        self._smooth_xy: dict[str, tuple[float, float]] = {}
        # {addr: {source: metres}} — ESPresense node-calibrated distances from
        # this poll's ads (rebuilt each poll; consumed by the spatial path)
        self._espresense_dist: dict[str, dict[str, float]] = {}
        # {addr: tx_power} and {source: {rssi_1m, n}} — per-poll caches for
        # per-tag / per-receiver path-loss in the spatial distance conversion
        self._addr_tx_power: dict[str, int] = {}
        self._pl_fits: dict[str, dict[str, Any]] = {}
        # {key: dict}  — spatial IDW centroid position (independent of k-NN)
        self._spatial_position: dict[str, dict] = {}
        # {key: (x, y)}  — EMA-smoothed position for spatial (independent of k-NN)
        self._spatial_smooth_xy: dict[str, tuple[float, float]] = {}
        # {key: str}  — spatial debug info (why centroid succeeded/failed)
        self._spatial_debug: dict[str, str] = {}
        # Per device: how many positioned scanners it USUALLY hears. Floor
        # selection compares against this to tell a gap in the data from a
        # genuine move — see _select_floor.
        self._floor_evidence: dict[str, float] = {}
        # {key: dict}  — last candidate info for diagnostics
        self._last_candidate: dict[str, dict[str, Any]] = {}
        # Throttle: {key: monotonic_ts} — last alert sent time per object
        self._alert_last_sent: dict[str, float] = {}
        _ALERT_COOLDOWN_S = 60  # min seconds between alerts for same device

        # ── Beacon auto-calibration rate-limit ──────────────────────────────────
        # {key: monotonic_ts} — last auto-calibration injection time per beacon
        self._beacon_autocal_last: dict[str, float] = {}

        # ── Velocity gate state ────────────────────────────────────────────────
        # {key: monotonic_ts} — when each device last changed rooms
        self._last_room_change_mono: dict[str, float] = {}
        # {key: monotonic_ts} — when each device entered its current confirmed room
        self._room_dwell_start: dict[str, float] = {}
        # {key: monotonic_ts} — when each device arrived on its current floor
        self._floor_dwell_start: dict[str, float] = {}
        # {key: floor_id} — each device's current confirmed floor
        self._device_floor: dict[str, str] = {}
        # {room_name: (cx, cy, map_id)} — room centroids (rebuilt each poll)
        self._room_centroids: dict[str, tuple[float, float, str]] = {}
        # RF barrier data for Gaussian scoring penalty (rebuilt each poll)
        # {scanner_source: (x, y, map_id)} — scanner positions from map receivers
        self._scanner_positions: dict[str, tuple[float, float, str]] = {}
        # 3D positioning (issue #54): absolute scanner heights + floor stack
        self._scanner_abs_z: dict[str, float] = {}
        self._floor_bases: dict[str, float] = {}
        self._floor_stack_idx: dict[str, int] = {}
        # Largest distance one RSSI reading may claim; scaled to the site.
        self._max_range_m: float = 50.0
        # {floor_id: (min_x, max_x, min_y, max_y)} — the building's extent
        # from the fabric, used to reject solver artifacts.
        self._floor_bounds: dict[str, tuple[float, float, float, float]] = {}
        # List of barrier dicts: [{points, attenuation_dbm, map_id}, ...]
        self._rf_barriers: list[dict] = []
        # Phase 2: True when spatial data is in metres (not map fractions)
        self._use_metres: bool = False

        # ── Per-scanner reliability (Phase 3) ─────────────────────────────────
        # {source: deque of bools} — True = scanner agreed with consensus this poll
        self._scanner_agree: dict[str, deque] = {}
        # {source: float} — cached reliability weight ∈ [_RELIABILITY_FLOOR, 1.0]
        self._scanner_reliability: dict[str, float] = {}

        # ── Adjacency co-visibility learning (Phase 1) ────────────────────────
        # Accumulates scanner co-visibility counts between rooms.
        # Key: frozenset({roomA, roomB}), value: count of polls where both rooms
        # heard the same device with RSSI > -80.
        self._co_visible: dict[frozenset, int] = {}
        # Poll counter for adjacency learning (compute every 50 polls)
        self._adj_learn_polls: int = 0

        # ── Adaptive learning rate-limit ───────────────────────────────────────
        # {key: monotonic_ts} — last adaptive observation time per device
        self._adaptive_last_obs: dict[str, float] = {}
        # {key: {source: rssi}} — RSSI vector of the last RECORDED observation,
        # for novelty gating (a stationary tag must not collapse the room
        # fingerprint to a single physical spot)
        self._adaptive_last_vec: dict[str, dict[str, float]] = {}
        # Save counter — only persist to disk every N observations (not every poll)
        self._adaptive_save_counter: int = 0
        # ── Automation tracking ───────────────────────────────────────────────
        # Set of device keys present in the previous poll result (for arrive/depart)
        self._prev_present: set[str] = set()

        # Suspend: when set, use only raw radio + spatial centroid (no k-NN, no adaptive)
        self._suspend_until: float = 0.0  # monotonic timestamp when suspend ends
        self._suspend_permanent: bool = False  # persisted via settings store

        # Restore persistent suspend from settings
        try:
            _st_init = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            if _st_init and _st_init.data.get("databases_suspended"):
                self._suspend_permanent = True
                _LOGGER.info("Databases suspended (restored from settings)")
        except Exception:
            pass

    # ── Suspend / reset smoothing state ─────────────────────────────────────

    @property
    def suspended(self) -> bool:
        """True when databases are suspended — raw radio + spatial only."""
        return self._suspend_permanent or time.monotonic() < self._suspend_until

    def suspend_databases(self, minutes: int = 60) -> None:
        """Suspend all learned/cached databases for N minutes.

        Clears all smoothing state and disables k-NN, adaptive learning,
        and scanner reliability for the duration.  Only raw radio RSSI +
        spatial weighted centroid is used for positioning.

        Also persists the flag so it survives HA restarts.
        """
        self.clear_smoothing_state()
        self._suspend_permanent = True
        self._suspend_until = time.monotonic() + minutes * 60
        # Persist so it survives restarts
        try:
            _st = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            if _st:
                _st.data["databases_suspended"] = True
                self.hass.async_create_task(_st.store.async_save(_st.data))
        except Exception:
            pass
        _LOGGER.info(
            "Databases suspended for %d minutes — raw radio + spatial centroid only",
            minutes,
        )

    def unsuspend_databases(self) -> None:
        """End suspension early — resume normal pipeline."""
        self._suspend_until = 0.0
        self._suspend_permanent = False
        self.clear_smoothing_state()  # start fresh when resuming too
        # Persist
        try:
            _st = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            if _st:
                _st.data.pop("databases_suspended", None)
                self.hass.async_create_task(_st.store.async_save(_st.data))
        except Exception:
            pass
        _LOGGER.info("Database suspension ended — full pipeline resumed")

    def clear_smoothing_state(self) -> None:
        """Wipe all accumulated smoothing state — fresh start from raw radio.

        Clears: Kalman RSSI, vote windows, confirmed rooms, k-NN cache,
        smooth XY, scanner reliability, velocity gate, silence tracking.
        Persistent stores (calibration, adaptive learning) are NOT touched.
        """
        self._ema_rssi.clear()
        self._kalman_p.clear()
        self._silence_miss.clear()
        self._kalman_addr_key.clear()
        self._room_votes.clear()
        self._confirmed_room.clear()
        self._room_confidence.clear()
        self._rssi_margin_confidence.clear()
        self._knn_position.clear()
        self._smooth_xy.clear()
        self._spatial_position.clear()
        self._spatial_smooth_xy.clear()
        self._scanner_agree.clear()
        self._scanner_reliability.clear()
        self._last_room_change_mono.clear()
        self._room_dwell_start.clear()
        self._floor_dwell_start.clear()
        self._device_floor.clear()
        self._co_visible.clear()
        self._adj_learn_polls = 0
        self._adaptive_last_obs.clear()
        self._adaptive_last_vec.clear()
        _LOGGER.info("Smoothing state cleared — fresh positioning from raw radio")

    # ── main update ──────────────────────────────────────────────────────────

    # ── CPU mode helpers ─────────────────────────────────────────────────────

    @staticmethod
    def cpu_pinning_supported() -> bool:
        """True when per-thread core pinning is available (Linux)."""
        return hasattr(os, "sched_setaffinity")

    def _effective_cpu_mode(self) -> str:
        """Resolve the cpu_mode setting, downgrading dedicated→single off-Linux."""
        st = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        mode = str((st.data if st else {}).get("cpu_mode") or "shared").strip().lower()
        if mode not in ("shared", "single", "dedicated"):
            mode = "shared"
        if mode == "dedicated" and not self.cpu_pinning_supported():
            mode = "single"
        return mode

    @staticmethod
    def _pin_compute_thread() -> None:
        """Executor initializer: pin the calling worker thread to one core.

        sched_setaffinity(0, …) applies to the calling *thread* on Linux, so
        only the compute worker is pinned — HA's loop and other threads keep
        their full mask.  Uses the highest-numbered available core (HA's own
        work skews toward low-numbered cores).
        """
        try:
            cpus = os.sched_getaffinity(0)
            if len(cpus) > 1:
                os.sched_setaffinity(0, {max(cpus)})
        except Exception:  # never let pinning failure kill the worker
            pass

    def _compute_executor_for(self, mode: str) -> ThreadPoolExecutor:
        """Return the single-thread compute executor, rebuilding on mode change."""
        if self._compute_executor is not None and self._compute_executor_mode == mode:
            return self._compute_executor
        if self._compute_executor is not None:
            self._compute_executor.shutdown(wait=False)
        self._compute_executor = ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="padspan_compute",
            initializer=self._pin_compute_thread if mode == "dedicated" else None,
        )
        self._compute_executor_mode = mode
        return self._compute_executor

    def shutdown_compute_executor(self) -> None:
        """Tear down the compute executor (config-entry unload)."""
        if self._compute_executor is not None:
            self._compute_executor.shutdown(wait=False)
            self._compute_executor = None
            self._compute_executor_mode = None

    def _excluded_sources(self) -> frozenset[str]:
        """Scanner sources the user has masked out of positioning (issue #59).

        Read fresh each poll so toggling exclusion takes effect immediately,
        with the last good value kept if settings are momentarily unavailable.
        """
        try:
            from .presence_rules import excluded_sources  # noqa: PLC0415

            _st = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            self._excluded_cache = excluded_sources((_st.data if _st else {}) or {})
        except Exception:
            pass
        return self._excluded_cache

    async def _async_update_data(self) -> dict[str, Any]:
        """Main poll loop — called every _SCAN_INTERVAL (10s) by HA's coordinator.

        High-level flow:
          1. Fetch the live BLE snapshot (advertisements + radios + objects)
          2. Resolve rotating private addresses (RPA) to canonical IDs
          3. Build per-device, per-scanner RSSI maps and source-to-area lookups
          4. For each BLE/iBeacon object, run the smoothing pipeline (_smooth_room)
          5. Apply pinned-beacon overrides for beacons with known map positions
          6. Carry forward stale objects for home/away persistence
          7. Fire follow-alerts and record movement history for room changes

        Returns {object_key: enriched_obj_dict} consumed by HA entities.
        """
        from .websocket import _live_snapshot  # noqa: PLC0415  (circular-import guard)
        from .private_ble_resolver import get_resolver  # noqa: PLC0415

        try:
            snap = await _live_snapshot(self.hass)
        except Exception as err:
            raise UpdateFailed(f"PadSpan snapshot error: {err}") from err

        now = time.monotonic()

        # ── Dynamic poll interval from settings ──────────────────────────────
        try:
            _st_pi = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            _pi = int((_st_pi.data if _st_pi else {}).get("presence_poll_interval_s") or 5)
            _pi = max(1, min(60, _pi))
            _new_interval = timedelta(seconds=_pi)
            if self.update_interval != _new_interval:
                self.update_interval = _new_interval
        except Exception:
            pass

        # Accumulates (key, old_room, new_room) tuples during this poll cycle;
        # processed at the end for alerts, movement history, and HA tag events.
        self._pending_room_changes: list[tuple[str, str | None, str]] = []

        # ── Resolve rotating MACs to canonical IDs ────────────────────────────
        # Build a mapping {raw_addr_upper → canonical_key} so that all rotating
        # MACs from the same phone merge into one Kalman state entry.
        resolver = await get_resolver(self.hass)
        _rpa_map: dict[str, str] = {}  # raw_addr → canonical_key
        if resolver.has_devices():
            for ad in (snap.get("ble") or {}).get("advertisements") or []:
                raw = str(ad.get("address") or "").upper()
                if raw and raw not in _rpa_map:
                    res = resolver.resolve_address(raw)
                    if res:
                        _rpa_map[raw] = str(res["canonical_id"]).upper()

        # ── Build per-device RSSI maps from raw advertisements ────────────
        # addr_src_rssi: {canonical_addr: {scanner_source: best_rssi}}
        # addr_tx_power: {canonical_addr: tx_power_level}
        # For resolved RPAs, the canonical_id is the key so all rotating MACs
        # from the same physical phone share one Kalman filter state.
        addr_src_rssi: dict[str, dict[str, float]] = {}
        addr_tx_power: dict[str, int] = {}
        # Stale-ad gate: only readings younger than ~3 polls may enter the
        # positioning fusion.  Without this, a receiver that last heard the
        # tag minutes ago keeps re-injecting its old RSSI every poll and
        # drags the position toward where the tag USED to be.  (The snapshot
        # keeps its wide age window for the UI object list — this gate only
        # protects the Kalman/spatial inputs.)
        _max_ad_age_s = 3.0 * self.update_interval.total_seconds()
        # Radios the user marked lost/disabled must not vote in positioning
        # (their handlers document this; the UI decoration keeps showing them)
        # One rule, one implementation — this used to know about lost and
        # disabled but not about excluded_scanners, so a receiver the user had
        # masked went on entering the RSSI maps while the smoothed-state purge
        # a few lines below was busy removing it.
        _excluded_srcs: set[str] = set(self._excluded_sources())
        _es_map: dict[str, dict[str, float]] = {}
        _ad_ages: dict[tuple[str, str], float] = {}
        for ad in (snap.get("ble") or {}).get("advertisements") or []:
            raw_addr = str(ad.get("address") or "").upper()
            addr = _rpa_map.get(raw_addr, raw_addr)  # canonical or raw
            src  = ad.get("source")
            rssi = ad.get("rssi")
            # Capture TX Power Level from the advertisement (BLE AD type 0x0A)
            # — a static device property, safe to take from an old ad.
            tx_pwr = ad.get("tx_power")
            if addr and tx_pwr is not None and addr not in addr_tx_power:
                addr_tx_power[addr] = int(tx_pwr)
            _age = ad.get("age_s")
            if isinstance(_age, (int, float)) and _age > _max_ad_age_s:
                continue
            if src and str(src) in _excluded_srcs:
                continue
            if addr and src and rssi is not None:
                existing = addr_src_rssi.setdefault(addr, {})
                # For merged RPAs, prefer the FRESHEST reading per scanner —
                # keeping the strongest let an old strong ad from a previous
                # rotating-MAC generation permanently outrank the live weaker
                # one.  Near-simultaneous readings (±0.5 s) break strongest.
                _k2 = (addr, str(src))
                _a = float(_age) if isinstance(_age, (int, float)) else 0.0
                _prev_a = _ad_ages.get(_k2)
                if (str(src) not in existing
                        or _a < _prev_a - 0.5
                        or (abs(_a - _prev_a) <= 0.5 and float(rssi) > existing[str(src)])):
                    existing[str(src)] = float(rssi)
                    _ad_ages[_k2] = _a
            # ESPresense nodes publish a node-calibrated, node-filtered
            # distance — collect it so the spatial path can use it directly
            # instead of re-deriving distance via the global path-loss model.
            _es_d = ad.get("espresense_distance")
            if addr and src and _es_d is not None:
                try:
                    _es_map.setdefault(addr, {})[str(src)] = float(_es_d)
                except (TypeError, ValueError):
                    pass
        self._espresense_dist = _es_map
        self._addr_tx_power = addr_tx_power
        # Per-receiver path-loss fits (metres-based) from the calibration
        # store, refreshed once per poll for the spatial distance conversion.
        try:
            _calib_pl = self.hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
            if _calib_pl and hasattr(_calib_pl, "path_loss_by_source"):
                self._pl_fits = _calib_pl.path_loss_by_source() or {}
            else:
                self._pl_fits = {}
        except Exception:
            self._pl_fits = {}

        # ── Build source-to-area and source-to-floor lookups ──────────────
        # Phase 1: read from the positioning fabric (ModelStore) when available.
        # In auto mode, also write-back any new radios from the snapshot.
        source_to_area: dict[str, str] = {}
        source_to_floor: dict[str, str] = {}
        _model = self.hass.data.get(DOMAIN, {}).get(DATA_MODEL)
        if _model:
            # The building's floors come from the HA floor registry, and the
            # positioning side needs them PERSISTED — floor_stack_index reads
            # the stored list, not the panel's live view of the registry, and
            # an unsynced list makes every storey collapse onto one slab.
            # Idempotent: it only writes when the set actually changed.
            try:
                from homeassistant.helpers import floor_registry as _fr_helper  # noqa: PLC0415
                _fr = _fr_helper.async_get(self.hass)
                await _model.async_sync_floors([
                    {"id": f.floor_id, "name": f.name, "level": getattr(f, "level", None)}
                    for f in _fr.async_list_floors()
                ])
            except Exception as _fl_err:
                _LOGGER.debug("Floor registry sync: %s", _fl_err)

            # In auto mode, sync snapshot radios into the fabric
            _radios = (snap.get("ble") or {}).get("radios") or []
            if _model.sync_mode() == "auto" and _radios:
                try:
                    await _model.async_sync_from_snapshot(_radios)
                    # One-time prune: remove ha_sync entries that aren't actual radios
                    if not getattr(self, "_fabric_pruned", False):
                        _radio_srcs = {str(r.get("source")) for r in _radios if r.get("source")}
                        _pruned = await _model.async_prune_non_radio_scanners(_radio_srcs)
                        self._fabric_pruned = True
                        if _pruned:
                            _LOGGER.info("Fabric: pruned %d non-radio scanner entries", _pruned)
                except Exception as _sync_err:
                    _LOGGER.warning("Fabric sync error: %s", _sync_err)
            # Read scanner mappings from fabric (includes both ha_sync and manual)
            source_to_area, source_to_floor = _model.get_scanner_mappings()

        # Fallback: if fabric has no scanners yet, build from snapshot directly
        # (first poll before fabric is populated)
        if not source_to_area:
            _area_to_floor: dict[str, str] = {}
            try:
                from homeassistant.helpers import area_registry as _ar_reg  # noqa: PLC0415
                for _a in _ar_reg.async_get(self.hass).async_list_areas():
                    _fl = getattr(_a, "floor_id", None)
                    if _a.name and _fl:
                        _area_to_floor[_a.name] = str(_fl)
            except Exception as _area_err:
                _LOGGER.debug("Area registry floor lookup: %s", _area_err)
            for r in (snap.get("ble") or {}).get("radios") or []:
                src  = r.get("source")
                area = r.get("area_name") or r.get("area")
                if src and area:
                    source_to_area[str(src)] = str(area)
                    fl = _area_to_floor.get(str(area))
                    if fl:
                        source_to_floor[str(src)] = fl

        # ── Apply per-scanner RSSI calibration offsets ────────────────────
        # Users can set per-scanner dBm offsets in Settings → Presence to
        # compensate for hardware differences between ESPHome boards.
        try:
            _st = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            _scanner_offsets: dict[str, float] = ((_st.data if _st else {}).get("scanner_offsets") or {})
            if _scanner_offsets:
                for _am in addr_src_rssi.values():
                    for _src in _am:
                        _off = _scanner_offsets.get(_src)
                        if _off:
                            _am[_src] = _am[_src] + float(_off)
        except Exception as _off_err:
            _LOGGER.debug("Scanner offset application: %s", _off_err)

        # ── Mask excluded scanners (issue #59) ───────────────────────────
        # A scanner that physically moves reports readings that are actively
        # misleading rather than merely absent, so the user can mask it out.
        # This is the single ingestion choke point: every matcher downstream
        # (k-NN, RSSI fallback voting, floor selection, trilateration) reads
        # from addr_src_rssi, so dropping the source here removes its
        # influence everywhere at once.
        #
        # The smoothed state must be purged too, not just the live readings:
        # an entry in _ema_rssi survives a silent source for ~5 minutes,
        # decaying while it still votes — so masking only the live map would
        # leave the excluded scanner influencing rooms long after exclusion.
        # Nothing stored is modified: un-excluding restores the source's
        # influence on the next poll.
        _excluded = self._excluded_sources()
        if _excluded:
            # Also drop it as a room/floor ANCHOR, not just as a reading: left
            # in source_to_area it still defines a known room and counts toward
            # the per-floor scanner census, so a wandering scanner would keep
            # steering floor selection and the k-NN room-override gate even
            # with all its readings gone.
            for _src in _excluded:
                source_to_area.pop(_src, None)
                source_to_floor.pop(_src, None)
            for _am in addr_src_rssi.values():
                for _src in _excluded:
                    _am.pop(_src, None)
            for _sm in self._ema_rssi.values():
                for _src in _excluded:
                    _sm.pop(_src, None)
            for _kpm in self._kalman_p.values():
                for _src in _excluded:
                    _kpm.pop(_src, None)

        # ── Dynamic vote-window sizing from room_change_delay_s setting ───
        # The user sets a desired delay in seconds; we convert that to a
        # vote window size and simple-majority threshold.  E.g. 20s at 10s
        # poll → window=2, threshold=2 (must win 2 of last 2 polls).
        try:
            _st2 = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            _delay_s = float(((_st2.data if _st2 else {}).get("room_change_delay_s") or 20.0))
            _delay_s = max(0.0, min(300.0, _delay_s))
            _dyn_vote_window = max(1, round(_delay_s / self.update_interval.total_seconds()))
            _dyn_vote_threshold = _dyn_vote_window // 2 + 1
        except Exception:
            _dyn_vote_window = _VOTE_WINDOW
            _dyn_vote_threshold = _VOTE_THRESHOLD

        objects: list[dict[str, Any]] = (snap.get("objects") or {}).get("list") or []
        result: dict[str, Any] = {}

        # ── Load pinned beacons from fabric (floor-based, no maps) ─────────
        _pinned: dict[str, dict[str, Any]] = {}
        try:
            if _model:
                for _bk_key, _bk_pos in _model.beacon_positions_m().items():
                    if not isinstance(_bk_pos, dict):
                        continue
                    _pinned[_bk_key] = {
                        "room": _bk_pos.get("room", ""),
                        "floor_id": _bk_pos.get("floor_id", ""),
                        "x_m": _bk_pos.get("x_m"),
                        "y_m": _bk_pos.get("y_m"),
                    }
        except Exception:
            pass

        # Floor-based room set from fabric geometry
        _fabric_rooms: set[str] = set()
        if _model:
            _fabric_rooms = set(_model.room_geometry_m().keys())

        # ── Spatial data from fabric (metre-space, floor-based, no maps) ──
        self._use_metres = False
        try:
            if _model:
                self._room_centroids = _model.room_centroids_m()
                self._scanner_positions = {
                    src: (pos["x_m"], pos["y_m"], pos.get("floor_id", ""))
                    for src, pos in _model.scanner_positions_m().items()
                }
                self._max_range_m = _site_range_cap(self._scanner_positions)
                self._floor_bounds = _floor_bounds_from_geometry(
                    _model.room_geometry_m()
                )
                # 3D: absolute scanner heights + floor stack (issue #54)
                self._scanner_abs_z = _model.scanner_absolute_z_m()
                self._floor_bases = _model.floor_base_elevations_m()
                self._floor_stack_idx = _model.floor_stack_index()
                _mb = _model.rf_barriers_m()
                self._rf_barriers = [
                    {
                        "points": [(float(p[0]), float(p[1])) for p in (b.get("points_m") or [])],
                        "attenuation_dbm": float(b.get("attenuation_dbm", 6)),
                        "material": str(b.get("material", "custom")),
                        "floor_id": str(b.get("floor_id", "")),
                    }
                    for b in _mb if len(b.get("points_m") or []) >= 2
                ]
                if self._room_centroids or self._scanner_positions:
                    self._use_metres = True
        except Exception:
            pass

        def _object_loop() -> None:
            """CPU-heavy per-object smoothing pipeline (Kalman + k-NN + votes).

            Runs inline in shared CPU mode, or on the one-thread compute
            executor in single/dedicated modes so HA's event loop stays
            responsive.  Coordinator refreshes are serialized and only this
            worker touches the smoothing state, so no locking is needed.
            """
            for obj in objects:
                key = obj.get("key", "")
                if not key:
                    continue

                # ── Re-entry detection: clear stale smoothing state ──────────────
                # If this device was absent (stale) in the previous poll and is now
                # back, reset the vote window and Kalman state so old-location votes
                # don't slow down re-assignment.
                if self._known_objs.get(key, {}).get("_stale"):
                    self._room_votes.pop(key, None)
                    self._room_confidence.pop(key, None)
                    # A stale room must not anchor first-poll attribution —
                    # clear the confirmed room and the adaptive novelty vector too
                    self._confirmed_room.pop(key, None)
                    self._adaptive_last_vec.pop(key, None)
                    self._knn_position.pop(key, None)
                    self._smooth_xy.pop(key, None)
                    self._spatial_position.pop(key, None)
                    self._spatial_smooth_xy.pop(key, None)
                    if obj.get("kind") in ("ble", "private_ble"):
                        # For private_ble, use canonical_id as Kalman key
                        _raw_addr = str(obj.get("address") or "").upper()
                        addr_clear = _rpa_map.get(_raw_addr, _raw_addr)
                        self._ema_rssi.pop(addr_clear, None)
                        self._kalman_p.pop(addr_clear, None)
                        self._silence_miss.pop(addr_clear, None)
                    elif obj.get("kind") == "ibeacon":
                        self._ema_rssi.pop(key, None)
                        self._kalman_p.pop(key, None)
                        self._silence_miss.pop(key, None)

                # Cache the live copy for home/away persistence
                self._last_seen[key] = now
                self._away_miss[key] = 0  # reset grace counter — device is present

                self._known_objs[key] = dict(obj)

                # ── Per-object smoothing pipeline ──────────────────────────────
                # Only BLE and iBeacon objects go through our Kalman + Gaussian +
                # vote pipeline.  Entity-based trackers (e.g. Bermuda) arrive
                # pre-smoothed from their own integration.
                if obj.get("kind") in ("ble", "private_ble"):
                    obj = dict(obj)  # copy — don't mutate the snapshot list in place
                    raw_addr = str(obj.get("address") or "").upper()
                    # For private_ble, use canonical_id as Kalman state key so all
                    # rotating MACs share one continuous smoothing state.
                    smooth_addr = _rpa_map.get(raw_addr, raw_addr)
                    self._rekey_kalman_state(key, smooth_addr)
                    smoothed_room = self._smooth_room(
                        key, smooth_addr, addr_src_rssi, source_to_area,
                        _dyn_vote_window, _dyn_vote_threshold, source_to_floor,
                        _fabric_rooms)
                    if smoothed_room:
                        obj["room"] = smoothed_room
                    obj["_smoothed"] = True
                    obj["room_confidence"] = self._room_confidence.get(key, 0.0)
                    obj["rssi_margin_confidence"] = self._rssi_margin_confidence.get(key, 0.0)
                    # Propagate sub-room position — prefer spatial (real-time geometry)
                    # over k-NN (historical calibration that may be stale).
                    _pos = self._spatial_position.get(key) or self._knn_position.get(key)
                    if _pos:
                        # Metres only: where the thing is, not where it lands
                        # on some photo. Drawing that is the panel's job.
                        obj["knn_confidence"] = _pos.get("confidence")
                        if _pos.get("x_m") is not None:
                            obj["x_m"] = _pos["x_m"]
                            obj["y_m"] = _pos["y_m"]
                            obj["floor_id"] = _pos.get("floor_id", obj.get("floor_id", ""))
                    # Store Kalman-smoothed per-source RSSI for scanner distance sensors
                    obj["_source_rssi"] = dict(self._ema_rssi.get(smooth_addr, {}))
                    # Propagate TX power if seen in advertisements
                    if smooth_addr in addr_tx_power:
                        obj.setdefault("tx_power", addr_tx_power[smooth_addr])
                    elif raw_addr in addr_tx_power:
                        obj.setdefault("tx_power", addr_tx_power[raw_addr])
                    self._known_objs[key] = dict(obj)  # refresh with smoothed data
                elif obj.get("kind") == "ibeacon":
                    obj = dict(obj)
                    # iBeacons may advertise from multiple MAC addresses (rotation).
                    # Merge RSSI across all known addresses, keeping the strongest
                    # per scanner, then feed the merged dict into _smooth_room under
                    # the UUID-based key (not a MAC address).
                    merged_src: dict[str, float] = {}
                    for a in (obj.get("all_addresses") or []):
                        for src, rssi in addr_src_rssi.get(str(a).upper(), {}).items():
                            if src not in merged_src or rssi > merged_src[src]:
                                merged_src[src] = rssi
                    # Pass merged RSSI under the UUID key as a synthetic single-addr dict
                    synthetic = {key: merged_src} if merged_src else {}
                    smoothed_room = self._smooth_room(
                        key, key, synthetic, source_to_area,
                        _dyn_vote_window, _dyn_vote_threshold, source_to_floor,
                        _fabric_rooms)
                    if smoothed_room:
                        obj["room"] = smoothed_room
                    obj["_smoothed"] = True
                    obj["room_confidence"] = self._room_confidence.get(key, 0.0)
                    obj["rssi_margin_confidence"] = self._rssi_margin_confidence.get(key, 0.0)
                    # Propagate sub-room position — prefer spatial over k-NN
                    _pos_ib = self._spatial_position.get(key) or self._knn_position.get(key)
                    if _pos_ib:
                        obj["knn_confidence"] = _pos_ib.get("confidence")
                        if _pos_ib.get("x_m") is not None:
                            obj["x_m"] = _pos_ib["x_m"]
                            obj["y_m"] = _pos_ib["y_m"]
                            obj["floor_id"] = _pos_ib.get("floor_id", obj.get("floor_id", ""))
                    # Store Kalman-smoothed per-source RSSI for scanner distance sensors
                    obj["_source_rssi"] = dict(self._ema_rssi.get(key, {}))
                    self._known_objs[key] = dict(obj)  # refresh with smoothed data

                # ── Pinned beacon room override ──────────────────────────────────
                if key in _pinned:
                    _pin = _pinned[key]
                    obj = dict(obj)  # copy — the snapshot is shared via the TTL cache
                    # A pin's room must be a real room. Legacy pins stamped a
                    # device LABEL into room when geometry couldn't resolve —
                    # confirming those creates phantom "rooms" on the overview.
                    if _pin["room"] and (
                            _pin["room"] in _fabric_rooms
                            or _pin["room"] in self._room_centroids):
                        obj["room"] = _pin["room"]
                        self._confirmed_room[key] = _pin["room"]
                    obj["_pinned"] = True

                result[key] = obj

        _cpu_mode = self._effective_cpu_mode()
        if _cpu_mode == "shared":
            _object_loop()
        else:
            await self.hass.loop.run_in_executor(
                self._compute_executor_for(_cpu_mode), _object_loop)

        # ── RSSI vector capture (opt-in, session-scoped, off by default) ─────
        # Observer only: it reads this poll's finished state and writes it to a
        # session file.  Nothing here feeds back into positioning, and when no
        # session is running the cost is one dict lookup and one bool read.
        #
        # It sits here rather than inside _object_loop for two reasons: one
        # site covers all three object kinds, and this is the event loop —
        # inside the loop we may be on the compute executor, where awaiting a
        # flush is not legal.
        _cap = self.hass.data.get(DOMAIN, {}).get(DATA_CAPTURE)
        if _cap is not None and _cap.recording:
            try:
                _st_f = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
                _followed_addrs = set((_st_f.data if _st_f else {}).get("followed_addrs") or [])
                _cap.record_frame(
                    result, addr_src_rssi, _rpa_map,
                    source_to_area, source_to_floor,
                    poll_s=self.update_interval.total_seconds(),
                    vote_window=_dyn_vote_window, vote_threshold=_dyn_vote_threshold,
                    pinned=_pinned, followed=_followed_addrs, coord=self)
                await _cap.async_maybe_flush()
            except Exception as err:
                _LOGGER.debug("Capture frame failed: %s", err)

        # ── Auto-calibration from pinned beacons ─────────────────────────────
        if _pinned:
            await self._inject_beacon_calibration(now, _pinned, result)

        # ── Grace period for missing objects ──────────────────────────────────
        # Devices that vanish from BLE get a 120s grace period (12 polls) to
        # cover normal BLE advertisement gaps.  After grace expires, the device
        # is evicted immediately — no lingering stale objects on the map.
        _evict_keys: list[str] = []
        _poll_s = max(1.0, self.update_interval.total_seconds())
        _away_grace_polls = max(2, round(_AWAY_GRACE_S / _poll_s))
        for key, last_obj in list(self._known_objs.items()):
            if key in result:
                continue
            miss = self._away_miss.get(key, 0) + 1
            self._away_miss[key] = miss
            if miss < _away_grace_polls:
                # Grace period — treat as still present
                grace = dict(last_obj)
                grace["age_s"] = 0.0
                # After a REAL absence (>60 s, not a routine 1-2 poll ad gap),
                # mark the cached copy stale so re-entry gets a fresh vote /
                # Kalman state instead of resuming old-location votes.  This
                # is what arms the re-entry cleanup branch, which previously
                # never fired because nothing set _stale.
                if miss * _poll_s >= 60.0:
                    grace["_stale"] = True
                    self._known_objs[key]["_stale"] = True
                result[key] = grace
                continue
            # Grace expired — evict
            _evict_keys.append(key)
        for key in _evict_keys:
            self._evict_object(key)

        # ── PadSpan automations: arrive/depart triggers ──────────────────────
        _cur_present = set(result.keys())
        _arrived = _cur_present - self._prev_present
        _departed = set(_evict_keys)  # keys that just got evicted = departed
        self._prev_present = _cur_present

        if _arrived or _departed:
            try:
                await self._run_automations(_arrived, _departed, result)
            except Exception as _auto_err:
                _LOGGER.warning("Automations error (non-fatal): %s", _auto_err)

        # ── Adjacency co-visibility learning (Phase 1) ────────────────────────
        # In auto mode, when no map-derived adjacency exists, learn room
        # adjacency from scanner co-visibility patterns.
        if _model and _model.sync_mode() == "auto" and not self._room_centroids:
            _CO_VIS_RSSI_THRESHOLD = -80.0
            for _addr, _src_rssi in addr_src_rssi.items():
                # Collect rooms that heard this device strongly
                _heard_rooms: set[str] = set()
                for _src, _rssi in _src_rssi.items():
                    if _rssi > _CO_VIS_RSSI_THRESHOLD:
                        _rm = source_to_area.get(_src)
                        if _rm:
                            _heard_rooms.add(_rm)
                # Every pair of rooms that heard the same device = co-visible
                _rl = sorted(_heard_rooms)
                for _i in range(len(_rl)):
                    for _j in range(_i + 1, len(_rl)):
                        _pair = frozenset({_rl[_i], _rl[_j]})
                        self._co_visible[_pair] = self._co_visible.get(_pair, 0) + 1

            self._adj_learn_polls += 1
            if self._adj_learn_polls >= 50:
                self._adj_learn_polls = 0
                # Compute adjacency from co-visibility counts above median
                if self._co_visible:
                    _counts = sorted(self._co_visible.values())
                    _median = _counts[len(_counts) // 2] if _counts else 0
                    _learned_adj: dict[str, list[str]] = {}
                    for _pair, _cnt in self._co_visible.items():
                        if _cnt >= max(_median, 2):  # at least 2 observations
                            _rooms = list(_pair)
                            _learned_adj.setdefault(_rooms[0], []).append(_rooms[1])
                            _learned_adj.setdefault(_rooms[1], []).append(_rooms[0])
                    # Write to ModelStore (only if we learned something)
                    if _learned_adj:
                        for _rm_name, _neighbors in _learned_adj.items():
                            try:
                                await _model.async_set_adjacency(_rm_name, sorted(set(_neighbors)))
                            except Exception:
                                pass
                    self._co_visible.clear()

        # ── Fire follow-alerts for room changes ────────────────────────────────
        if self._pending_room_changes:
            await self._process_room_alerts(now, result)
            await self._record_movement(result)
            # Emit HA tag events for room changes (Feature 1)
            try:
                from .const import DATA_TAG_INTEGRATION
                tag_int = self.hass.data.get(DOMAIN, {}).get(DATA_TAG_INTEGRATION)
                if tag_int:
                    await tag_int.async_emit_room_changes(
                        self._pending_room_changes, result
                    )
            except Exception:
                pass
            self._pending_room_changes.clear()

        # ── Proactive state cleanup ─────────────────────────────────────────────
        # Every 100 polls (~16 min at 10s interval), sweep all per-object state
        # dicts and evict keys that haven't been seen recently. This prevents
        # unbounded memory growth from transient BLE devices.
        if not hasattr(self, "_cleanup_counter"):
            self._cleanup_counter = 0
        self._cleanup_counter += 1
        if self._cleanup_counter >= 100:
            self._cleanup_counter = 0
            _stale_keys = []
            _cutoff = time.monotonic() - 1800.0  # 30 min
            for _k, _ts in list(self._last_seen.items()):
                if _ts < _cutoff and _k not in result:
                    _stale_keys.append(_k)
            for _k in _stale_keys:
                self._evict_object(_k)
            if _stale_keys:
                _LOGGER.debug("Proactive cleanup: evicted %d stale objects", len(_stale_keys))

        # ── Scanner health summary (Phase 3) ──────────────────────────────────
        # Expose per-scanner reliability weights for the UI to display.
        # Stored under a special key that won't collide with object keys.
        _sh: dict[str, Any] = {}
        for _src, _rel in self._scanner_reliability.items():
            _q = self._scanner_agree.get(_src)
            _polls = len(_q) if _q else 0
            _agree_pct = round(sum(_q) / _polls * 100, 0) if _polls else 100
            _sh[_src] = {
                "reliability": _rel,
                "agree_pct": _agree_pct,
                "polls": _polls,
                "room": source_to_area.get(_src, ""),
            }
        result["__scanner_health__"] = _sh

        # ── Experimental MQTT publishing ─────────────────────────────────────
        await self._async_mqtt_publish(result)

        return result

    # ── MQTT publishing (experimental) ───────────────────────────────────────

    async def _async_mqtt_publish(self, result: dict[str, Any]) -> None:
        """Publish device state to MQTT topics if enabled in settings.

        Publishes to padspan/devices/{slug}/state (JSON), /area, and /distance
        with retain=True so MQTT consumers get the last known state on connect.
        Only devices with a user_label are published (unlabeled devices are
        typically not interesting for external automation).
        Errors are silently logged — MQTT is optional and must never break the
        presence pipeline.
        """
        try:
            st = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            if not st or not (st.data or {}).get("mqtt_publish_enabled", False):
                return
            from homeassistant.components.mqtt import async_publish  # noqa: PLC0415
            import json as _json  # noqa: PLC0415
            for key, obj in result.items():
                label = obj.get("user_label")
                if not label:
                    continue
                slug = label.lower().replace(" ", "_")
                topic_base = f"padspan/devices/{slug}"
                # State JSON
                payload = {
                    "room": obj.get("room"),
                    "rssi": obj.get("rssi"),
                    "age_s": obj.get("age_s"),
                    "home": not (isinstance(obj.get("age_s"), (int, float)) and obj["age_s"] > 300),
                    "room_confidence": obj.get("room_confidence"),
                }
                await async_publish(self.hass, f"{topic_base}/state", _json.dumps(payload), retain=True)
                await async_publish(self.hass, f"{topic_base}/area", obj.get("room") or "unknown", retain=True)
                dist = obj.get("distance")
                if dist is not None:
                    await async_publish(self.hass, f"{topic_base}/distance", str(dist), retain=True)
        except ImportError:
            _LOGGER.debug("MQTT component not available — skipping MQTT publish")
        except Exception:
            _LOGGER.debug("MQTT publish error", exc_info=True)

    # ── smoothing helpers ─────────────────────────────────────────────────────

    def _select_floor(
        self,
        key: str,
        src_list: list[tuple[str, float, float, float, str]],
        sticky: str,
    ) -> str:
        """Which floor is this device on?

        Scored from AGGREGATE evidence — the mean of a floor's top-2 RSSI, with
        a lone scanner taking a small handicap. A single-strongest rule let one
        cross-floor bleed (a scanner directly above, loud through the slab) flip
        the whole centroid, after which the slab penalty punished the true
        floor's scanners.

        The part that was missing is a sense of HOW MUCH evidence there was.
        The score was recomputed from scratch every poll and compared on equal
        terms whether fifteen scanners had reported or two, with a flat +4 dB
        nudge for the current floor as the only damping. Measured on a real
        house: in a poll where the scanner count fell from ~15 to 4, three of
        ten tracked objects changed floor at once, and four more changed back
        on the next poll. Every device shares these inputs, so they move as a
        group — which is what "the beacons jump together" looks like from the
        outside, and it is not a per-device problem at all.

        So a floor change now has to clear the same kind of bar the other two
        stages already impose — `_SILENCE_GRACE` before RSSI decays, the vote
        window before a room is confirmed. Two conditions, both about evidence
        rather than about the answer:

          EVIDENCE  a floor change needs this device to have heard a fair share
                    of what it USUALLY hears. Relative, not absolute: an
                    absolute floor cannot work here, because floor selection is
                    only reached once at least three positioned scanners have
                    reported, so any constant at or below three is unreachable.
                    What separates a gap from a move is that the device heard
                    far less than its own norm.
          MARGIN    the challenger must beat the incumbent by `_FLOOR_SWITCH_DB`
                    beyond the stickiness bonus, so a floor changes on a real
                    difference rather than on noise.

        With no sticky floor (a device we have never placed) the best score
        wins outright — there is nothing to hold on to, and refusing to answer
        would be worse than answering.
        """
        # What this device usually hears. Rises to a new high immediately,
        # forgets slowly — see _FLOOR_EVIDENCE_DECAY. Updated every poll,
        # including the thin ones, so a real reduction is eventually adopted.
        heard = len(src_list)
        baseline = max(self._floor_evidence.get(key, 0.0) * _FLOOR_EVIDENCE_DECAY,
                       float(heard))
        self._floor_evidence[key] = baseline

        by_floor: dict[str, list[float]] = {}
        for _src, _sx, _sy, _rssi, _sf in src_list:
            if _sf:
                by_floor.setdefault(_sf, []).append(_rssi)
        if not by_floor:
            return sticky

        scores: dict[str, float] = {}
        for _sf, vals in by_floor.items():
            top = sorted(vals, reverse=True)[:2]
            scores[_sf] = sum(top) / len(top) - (3.0 if len(top) < 2 else 0.0)

        if sticky not in scores:
            # Nothing to hold: either a first placement, or the sticky floor has
            # gone completely silent and holding it would strand the device.
            return max(scores, key=lambda f: scores[f])

        challenger = max(scores, key=lambda f: scores[f])
        if challenger == sticky:
            return sticky

        # Far less heard than this device normally hears: a gap, not a move.
        if heard < baseline * _FLOOR_EVIDENCE_FRACTION:
            self._spatial_debug[key] = (
                f"floor_held:evidence {heard}<{baseline * _FLOOR_EVIDENCE_FRACTION:.1f}"
                f" (usual {baseline:.1f})")
            return sticky

        if scores[challenger] - scores[sticky] < _FLOOR_STICKY_DB + _FLOOR_SWITCH_DB:
            self._spatial_debug[key] = (
                f"floor_held:margin {scores[challenger] - scores[sticky]:.1f}dB"
                f"<{_FLOOR_STICKY_DB + _FLOOR_SWITCH_DB:.1f}")
            return sticky
        return challenger

    def _smooth_room(
        self,
        key: str,
        addr: str,
        addr_src_rssi: dict[str, dict[str, float]],
        source_to_area: dict[str, str],
        vote_window: int = _VOTE_WINDOW,
        vote_threshold: int = _VOTE_THRESHOLD,
        source_to_floor: dict[str, str] | None = None,
        fabric_rooms: set[str] | None = None,
    ) -> str | None:
        """Run one poll cycle of the full smoothing pipeline for a single BLE device.

        Pipeline stages executed in order:
          1. Kalman filter — smooth raw RSSI per (device, scanner) pair
          2. Gaussian room scoring — convert smoothed RSSI to distance-weighted
             room scores, with hysteresis to prevent boundary flickering
          3. Floor stickiness — require extra margin for cross-floor transitions
          4. Adaptive blend — mix in learned fingerprint similarity (if enabled)
          5. k-NN override — use calibration fingerprints when confident enough
          6. Majority vote — temporal window for final room confirmation

        Args:
            key: Object key (used for vote state and confidence tracking)
            addr: Kalman state key (canonical address or UUID for iBeacons)
            addr_src_rssi: Full {addr: {source: rssi}} map for this poll cycle
            source_to_area: {scanner_source: HA_area_name}
            vote_window / vote_threshold: Dynamic sizing from room_change_delay_s
            source_to_floor: {scanner_source: floor_id} for cross-floor logic
            fabric_rooms: Room names from fabric geometry (tie-breaking)
            (Map-centric parameters removed — fabric is the sole authority)

        Returns the confirmed (stable) room name, or None if not yet established.
        Side-effects: updates self._room_confidence, _rssi_margin_confidence,
        _knn_position, _confirmed_room, and _room_votes for this key.
        """
        # Normalize optional maps once — spot guards existed at most (not
        # all) access sites; a None source_to_floor crashed the
        # _scanners_per_floor loop below.
        source_to_floor = source_to_floor or {}
        # Phase 1/2: resolve ModelStore for fabric adjacency + metre thresholds
        _model = self.hass.data.get(DOMAIN, {}).get(DATA_MODEL)

        # Build room→floor lookup for outdoor/floor logic
        _room_to_floor: dict[str, str] = {}
        if source_to_floor:
            for _src2, _area2 in source_to_area.items():
                _fl2 = source_to_floor.get(_src2)
                if _fl2 and _area2 not in _room_to_floor:
                    _room_to_floor[_area2] = _fl2

        # Count scanners per floor (for isolated scanner detection)
        _scanners_per_floor: dict[str, int] = {}
        for _src2 in source_to_area:
            _fl2 = source_to_floor.get(_src2, "")
            if _fl2:
                _scanners_per_floor[_fl2] = _scanners_per_floor.get(_fl2, 0) + 1

        live_srcs = addr_src_rssi.get(addr, {})

        # ── Stage 1: Kalman-filtered RSSI per source ─────────────────────────
        if addr not in self._ema_rssi:
            self._ema_rssi[addr] = {}
        if addr not in self._kalman_p:
            self._kalman_p[addr] = {}
        ema = self._ema_rssi[addr]
        kp  = self._kalman_p[addr]

        # Read Q/R from settings (allows runtime tuning without restart)
        try:
            _st = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            _d = (_st.data if _st else {}) or {}
            _Q = float(_d.get("kalman_q", _KALMAN_Q))
            _R = float(_d.get("kalman_r", _KALMAN_R))
        except Exception:
            _Q = _KALMAN_Q
            _R = _KALMAN_R
        # Process noise accumulates per unit TIME — scale Q with the poll
        # interval (tuned at the historical 10 s poll) so filter lag stays
        # constant when the user changes presence_poll_interval_s.
        _poll_s = max(1.0, self.update_interval.total_seconds())
        _Q = _Q * (_poll_s / 10.0)

        # Kalman update for sources that reported this poll.
        # K (Kalman gain) adapts automatically: high P (uncertainty) → K≈1
        # (trust new measurement); low P → K≈0 (trust existing estimate).
        for src, rssi in live_srcs.items():
            # ESPresense readings are already filtered at the node — trust
            # them more (lower measurement noise) instead of double-smoothing
            # with the same R as raw proxy advertisements.
            _r_src = _R * 0.25 if src.startswith("espresense_") else _R
            if src in ema:
                p = kp.get(src, _R)
                K = p / (p + _r_src)                    # Kalman gain
                ema[src] = ema[src] + K * (rssi - ema[src])  # state update
                kp[src] = (1.0 - K) * p + _Q            # covariance update
            else:
                ema[src] = rssi   # first observation — seed directly
                kp[src] = _r_src  # initialize at max uncertainty

        # Decay sources that did NOT report.  BLE advertisements are probabilistic
        # — a scanner can miss 1-2 polls even when the device is stationary nearby.
        # To prevent phantom room switches from normal BLE jitter, we only start
        # decaying after a source has been silent for _SILENCE_GRACE consecutive
        # polls.  This means a single missed advertisement doesn't affect scoring.
        #
        # Total silence (no scanners reporting) uses a gentler -95 dBm target;
        # partial silence (some scanners active = possible movement) uses -100 dBm.
        # ~20 s of silence before decay starts, expressed in polls at the
        # current interval (2 at the historical 10 s poll, 4 at 5 s)
        _SILENCE_GRACE = max(1, round(20.0 / _poll_s))
        if addr not in self._silence_miss:
            self._silence_miss[addr] = {}
        _miss = self._silence_miss[addr]

        _all_silent = len(live_srcs) == 0 and len(ema) > 0
        _decay_target = -95.0 if _all_silent else _EMA_SILENCE_DBM

        # Reset miss counter for sources that reported this poll
        for src in live_srcs:
            _miss.pop(src, None)

        for src in list(ema):
            if src not in live_srcs:
                _miss[src] = _miss.get(src, 0) + 1
                if _miss[src] < _SILENCE_GRACE:
                    continue  # grace period — hold RSSI steady, don't decay
                # Hard cap: the all-silent decay target (-95) sits ABOVE the
                # -98 prune threshold, so entries asymptotically approach -95
                # and were never pruned.  ~5 min of silence is decisive.
                if _miss[src] >= max(6, round(300.0 / _poll_s)):
                    del ema[src]
                    kp.pop(src, None)
                    _miss.pop(src, None)
                    continue
                p = kp.get(src, _R)
                K = p / (p + _R)
                ema[src] = ema[src] + K * (_decay_target - ema[src])
                kp[src] = (1.0 - K) * p + _Q
                if ema[src] < _EMA_PRUNE_DBM:
                    del ema[src]
                    kp.pop(src, None)
                    _miss.pop(src, None)

        # Live subset: only sources that reported THIS poll.  Synthetic
        # hold/decay values stay in `ema` for room-score hysteresis and
        # display, but must not feed fingerprint (k-NN/RF) or adaptive
        # queries as if they were real measurements.
        _live_ema = {s: v for s, v in ema.items() if _miss.get(s, 0) == 0}

        # ── Stage 1.5 prep: read path-loss model parameters ────────────────
        # ref_power: RSSI at 1 meter (typically -59 to -65 dBm)
        # path_loss_exp: environment factor (2.0 = free space, 3-4 = indoors)
        # room_sigma_m: Gaussian width — controls how quickly score drops with distance
        try:
            _st_pl = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            _d_pl  = (_st_pl.data if _st_pl else {}) or {}
            _ref   = float(_d_pl.get("ref_power",    DEFAULT_REF_POWER))
            _n_exp = float(_d_pl.get("path_loss_exp", DEFAULT_PATH_LOSS_EXP))
            _sigma = float(_d_pl.get("room_sigma_m",  DEFAULT_ROOM_SIGMA_M))
            _floor_on = bool(_d_pl.get("adaptive_floor_detection", False))
            _dev_h = max(0.0, min(3.0, float(_d_pl.get("assumed_device_height_m", 1.0))))
        except Exception:
            _ref   = DEFAULT_REF_POWER
            _n_exp = DEFAULT_PATH_LOSS_EXP
            _sigma = DEFAULT_ROOM_SIGMA_M
            _floor_on = False
            _dev_h = 1.0

        # ── Room scoring ──────────────────────────────────────────────────
        # Two scoring paths:
        #   A) Spatial: when scanner positions + room geometry are available,
        #      estimate the device's (x, y) via inverse-distance-weighted
        #      centroid of scanner positions, then check which room polygon
        #      contains that point.  This is true indoor positioning — it
        #      works even for rooms without a dedicated scanner.
        #   B) Fallback: strongest effective RSSI per room (original method).
        # Both paths feed into the same hysteresis + vote pipeline below.
        candidate: str | None = None
        rssi_margin_confidence: float = 0.0
        room_scores: dict[str, float] = {}
        _spatial_xy: tuple[float, float, str] | None = None  # (x_m, y_m, floor_id)
        _spatial_candidate: str | None = None  # room from geometry check
        _cur_confirmed = self._confirmed_room.get(key)
        if ema:
            # RSSI margin confidence (for entity attributes)
            sorted_vals = sorted(ema.values(), reverse=True)
            if len(sorted_vals) >= 2:
                rssi_margin_confidence = round(
                    min(1.0, max(0.0, (sorted_vals[0] - sorted_vals[1]) / 15.0)), 2
                )
            else:
                rssi_margin_confidence = 1.0

            # ── Path A: spatial positioning via weighted centroid ─────────
            # Requires ≥3 scanners with known positions and live RSSI.
            # Converts RSSI → distance via path-loss model, then computes
            # inverse-distance² weighted centroid of scanner positions.
            if not (self._use_metres and self._scanner_positions and _model):
                self._spatial_debug[key] = f"disabled:metres={self._use_metres},pos={len(self._scanner_positions)},model={bool(_model)}"
            if self._use_metres and self._scanner_positions and _model:
                # Collect scanners with known positions.  A source is excluded
                # once it is DECAYING — not merely because it missed a poll.
                #
                # The principle behind the old rule was right: a decayed value
                # is synthetic and must not steer the estimate.  It was applied
                # one stage too early.  Within the grace window the Kalman
                # stage above holds the last REAL measurement unchanged (see
                # `if _miss[src] < _SILENCE_GRACE: continue` — it holds, it
                # does not fabricate); only past the window does it start
                # pulling the value toward the silence target.  Dropping an
                # anchor on its first missed poll therefore discarded a genuine
                # measurement that the stage before had deliberately preserved,
                # and the two stages contradicted each other inside one
                # function.
                #
                # The cost was not subtle.  BLE advertisements are
                # probabilistic, so scanners miss polls constantly and every
                # device loses the SAME scanner on the SAME poll — the anchor
                # set changes for all of them at once and they move as a group,
                # in whichever part of the house that scanner anchors.
                # Measured with the capture harness: a poll where the heard
                # count fell from ~15 to 4 moved three of ten tracked objects,
                # and four more moved back on the recovery poll.
                _src_list: list[tuple[str, float, float, float, str]] = []
                for _src, _rssi in ema.items():
                    if _miss.get(_src, 0) >= _SILENCE_GRACE:
                        continue
                    _sp = self._scanner_positions.get(_src)
                    if not _sp:
                        continue
                    _src_list.append((_src, _sp[0], _sp[1], _rssi, _sp[2]))

                if len(_src_list) < 3:
                    self._spatial_debug[key] = f"need_3_pos_scanners:got_{len(_src_list)}_of_{len(ema)}_ema"
                if len(_src_list) >= 3:
                    _fl_sticky = self._device_floor.get(key) or _room_to_floor.get(_cur_confirmed or "", "")
                    _best_floor = self._select_floor(key, _src_list, _fl_sticky)

                    # Cross-floor scanners take a slab penalty per SLAB CROSSED
                    # (issue #54), and — the part that matters for accuracy —
                    # they only join the x/y solve when the chosen floor cannot
                    # solve on its own.
                    #
                    # A scanner one storey away hears the device THROUGH the
                    # slab. Its RSSI says something about which floor the
                    # device is on and almost nothing about where on that floor
                    # it is: the path went mostly vertical, and the slab
                    # penalty is a single average number standing in for
                    # concrete, joists, ducting and whatever furniture is
                    # stacked over the ceiling. Feeding those readings into a
                    # horizontal centroid as if they were on-floor ranges is
                    # what let two garage scanners at -74 drag a device that
                    # its own closet scanner heard at -63 down a storey and
                    # into a point outside every room. Position wandered while
                    # the room vote — which never used them that way — stayed
                    # put. So the on-floor set solves position whenever it can;
                    # cross-floor readings are the fallback for a floor too
                    # thinly covered to solve alone, not a routine input.
                    _SLAB_PENALTY_DB = 10.0  # dBm penalty per slab crossed
                    _dev_floor_idx = self._floor_stack_idx.get(_best_floor)

                    def _slabs_crossed(_sf: str) -> int:
                        if _sf == _best_floor:
                            return 0
                        _si = self._floor_stack_idx.get(_sf)
                        if _si is None or _dev_floor_idx is None:
                            return 1  # unknown stacking — legacy flat penalty
                        return abs(_si - _dev_floor_idx)

                    # Assumed device height: carry height above the estimated
                    # floor's walking surface (pocketed phone ~1.0 m).
                    _dev_abs_z = self._floor_bases.get(_best_floor, 0.0) + _dev_h
                    # ESPresense nodes publish a node-calibrated distance —
                    # use it directly instead of the global path-loss model.
                    # Slab penalty translates to distance space as a
                    # multiplier (d ∝ 10^(-rssi/(10n))).
                    _es_direct_raw = self._espresense_dist.get(addr) or {}
                    _cf_mult = 10.0 ** (_SLAB_PENALTY_DB / (10.0 * _n_exp))
                    _es_direct: dict[str, float] = {}
                    _all_scanners: list[tuple[str, float, float, float, float]] = []
                    _on_floor: list[tuple[str, float, float, float, float]] = []
                    for _src, _sx, _sy, _rssi, _sf in _src_list:
                        _n_slabs = _slabs_crossed(_sf)
                        if _src in _es_direct_raw:
                            _es_direct[_src] = _es_direct_raw[_src] * (_cf_mult ** _n_slabs)
                        _adj_rssi = _rssi - _SLAB_PENALTY_DB * _n_slabs
                        # Vertical offset scanner ↔ device, for slant→horizontal
                        # correction (falls back to the legacy 2.4 m default z).
                        _dz = self._scanner_abs_z.get(_src, 2.4) - _dev_abs_z
                        _entry = (_src, _sx, _sy, _adj_rssi, _dz)
                        _all_scanners.append(_entry)
                        if _n_slabs == 0:
                            _on_floor.append(_entry)

                    # On-floor scanners solve position when there are enough of
                    # them; the cross-floor set is only admitted when there are
                    # not. Three is the solve's own minimum (below it there is
                    # no plane to fit), so the fallback engages exactly when
                    # the on-floor evidence could not have produced a position
                    # by itself.
                    if len(_on_floor) >= 3:
                        _all_scanners = _on_floor

                    if len(_all_scanners) >= 2:
                        # Per-tag reference power: iBeacon measured power is a
                        # genuine RSSI@1m; BLE AD 0x0A radiated power (0..+12
                        # dBm) is NOT — only accept plausible dBm@1m values.
                        _tag_ref = None
                        _tp = self._addr_tx_power.get(addr)
                        if _tp is not None and -90 <= _tp <= -30:
                            _tag_ref = float(_tp)

                        # ── Two-pass IDW centroid with RF barrier correction ──
                        def _scanner_dists(scanners, ref_pt=None):
                            """Per-scanner HORIZONTAL distance estimates (metres).

                            RSSI (and node-calibrated distance) measures the
                            SLANT range; the centroid/WLS solve in the
                            horizontal plane, so the vertical offset is
                            deducted: d_h = sqrt(d² − dz²).  A ceiling scanner
                            directly overhead reads d≈2.4 m but d_h≈0 — the
                            2D code pushed the estimate 2.4 m sideways.
                            """
                            _out: list[tuple[float, float, float]] = []
                            for _s_src, _sx, _sy, _rssi, _dz in scanners:
                                _att = 0.0
                                if ref_pt and self._rf_barriers:
                                    _att = _barrier_attenuation(
                                        _sx, _sy, _best_floor,
                                        ref_pt[0], ref_pt[1], _best_floor,
                                        self._rf_barriers,
                                    )
                                # Reference power / exponent: per-receiver fit
                                # from calibration data when available, else
                                # the tag's own measured power, else global.
                                _fit = self._pl_fits.get(_s_src)
                                if _fit:
                                    _ref_s = float(_fit.get("rssi_1m", _ref))
                                    _n_s = float(_fit.get("n", _n_exp))
                                else:
                                    _ref_s = _tag_ref if _tag_ref is not None else _ref
                                    _n_s = _n_exp
                                _dd = _es_direct.get(_s_src)
                                if _dd is not None:
                                    # Node distance includes wall attenuation →
                                    # overestimated; correct in distance space.
                                    _d = _dd * (10.0 ** (-_att / (10.0 * _n_s)))
                                else:
                                    # A wall makes measured RSSI weaker than free
                                    # space; recover the geometric distance by
                                    # ADDING the attenuation back (the old -=
                                    # doubled the through-wall error instead).
                                    _d = 10.0 ** ((_ref_s - (_rssi + _att)) / (10.0 * _n_s))
                                _d_slant = _d
                                _d = _slant_to_horizontal(_d, _dz)
                                _out.append((
                                    _sx, _sy,
                                    max(0.3, min(_d, self._max_range_m)),
                                    _range_weight(_d, _d_slant),
                                ))
                            return _out

                        def _idw_centroid(scanners, ref_pt=None):
                            _wx = 0.0; _wy = 0.0; _wt = 0.0
                            for _sx, _sy, _d, _w in _scanner_dists(scanners, ref_pt):
                                _wx += _sx * _w
                                _wy += _sy * _w
                                _wt += _w
                            return (_wx / _wt, _wy / _wt) if _wt > 0 else None

                        _p1 = _idw_centroid(_all_scanners)
                        if _p1:
                            _p2 = _idw_centroid(_all_scanners, ref_pt=_p1) if self._rf_barriers else _p1
                            _est_x, _est_y = _p2 or _p1
                            # ── WLS multilateration refinement ────────────
                            # The IDW centroid cannot leave the receivers'
                            # convex hull and snaps toward the strongest one.
                            # Gauss-Newton over the same distances, seeded by
                            # the centroid, can place the tag between or
                            # outside receivers (3+ ranges constrain a point).
                            if len(_all_scanners) >= 3:
                                _rx, _ry = _wls_refine(
                                    _est_x, _est_y,
                                    _scanner_dists(
                                        _all_scanners,
                                        ref_pt=(_est_x, _est_y) if self._rf_barriers else None,
                                    ),
                                )
                                # WLS is allowed to leave the receivers' hull —
                                # that is the whole point of it — but not to
                                # leave the BUILDING.  On inconsistent ranges
                                # Gauss-Newton can walk up to 15 m (3 damped
                                # iterations), which put devices in the garden.
                                # The centroid seed is a convex combination of
                                # scanner positions, so it is always physically
                                # plausible; fall back to it rather than ship a
                                # refinement the fabric says cannot be real.
                                if _within_floor_bounds(
                                    _rx, _ry, _best_floor, self._floor_bounds
                                ):
                                    _est_x, _est_y = _rx, _ry
                                else:
                                    self._spatial_debug[key] = (
                                        f"wls_rejected_outside_site:"
                                        f"({_rx:.1f},{_ry:.1f})@{_best_floor}"
                                    )
                            # Smooth BEFORE the room decision — the raw
                            # per-poll estimate jitters across polygon
                            # boundaries; the room lookup must see the same
                            # stabilized position the user sees on the map.
                            _prev_sp_fl = (self._spatial_position.get(key) or {}).get("floor_id")
                            if _prev_sp_fl and _prev_sp_fl != _best_floor:
                                self._spatial_smooth_xy.pop(key, None)  # floor change → fresh state
                            _est_x, _est_y = self._ab_smooth_xy(
                                self._spatial_smooth_xy, key, _est_x, _est_y
                            )
                            _spatial_xy = (_est_x, _est_y, _best_floor)
                            self._spatial_debug[key] = f"computed:({_est_x:.1f},{_est_y:.1f})@{_best_floor}"

                            _geo_room = _model.beacon_room_from_geometry(
                                _est_x, _est_y, _best_floor
                            )
                            if _geo_room:
                                _spatial_candidate = _geo_room
                                self._spatial_debug[key] += f">{_geo_room}"
                            else:
                                # Position outside all room polygons — do NOT
                                # guess via nearest centroid.  Let RSSI scoring
                                # decide; it uses ALL scanners (not just those
                                # with positions) and has hysteresis/penalties.
                                self._spatial_debug[key] += ">NO_GEOMETRY_HIT"
                        else:
                            self._spatial_debug[key] = "idw_returned_none"

            # ── Path B: RSSI-based room scoring (always computed) ────────
            # This provides the fallback and also feeds the debug log.
            # Scanners silent past the hold grace carry DECAYED synthetic
            # values — those must not vote against live signals (the spatial
            # path already excludes non-reporting scanners; this is the same
            # discipline, softened to tolerate normal BLE advertisement loss:
            # a held-fresh value inside the grace still votes).
            _stale_after = max(1, round(20.0 / max(self.update_interval.total_seconds(), 1.0)))
            for _src, _rssi in ema.items():
                if _miss.get(_src, 0) > _stale_after:
                    continue
                _room = source_to_area.get(_src)
                if not _room:
                    continue
                _eff_rssi = _rssi
                # Cross-floor attenuation
                if _floor_on and source_to_floor:
                    _src_fl = source_to_floor.get(_src, "")
                    _room_fl = _room_to_floor.get(_room, "")
                    if _src_fl and _room_fl and _src_fl != _room_fl:
                        _applied_floor_atten = False
                        try:
                            _ad_s = self.hass.data.get(DOMAIN, {}).get(DATA_ADAPTIVE)
                            if _ad_s:
                                _learned_delta = _ad_s.learned_floor_attenuation(_room_fl, _src_fl)
                                if _learned_delta is not None:
                                    _eff_rssi += _learned_delta
                                    _applied_floor_atten = True
                        except Exception as _fl_err:
                            _LOGGER.debug("Floor attenuation error: %s", _fl_err)
                        if not _applied_floor_atten:
                            _eff_rssi -= 10.0  # default cross-floor penalty
                # Scanner reliability penalty (convert to dBm: low reliability = weaker)
                # Skip when suspended — reliability scores may be poisoned
                _rel = 1.0 if self.suspended else self._scanner_reliability.get(_src, 1.0)
                if _rel < 0.8:
                    _eff_rssi -= (1.0 - _rel) * 10.0  # up to -5 dBm for worst scanners
                # Outdoor penalty: -15 dBm for indoor→outdoor transitions only.
                # Skip when device has no confirmed room yet (first placement)
                # so outdoor devices aren't forced indoors on initial detection.
                _cur_confirmed = self._confirmed_room.get(key)
                _cur_floor_id = _room_to_floor.get(_cur_confirmed, "") if _cur_confirmed else ""
                if _cur_confirmed and _cur_floor_id != OUTSIDE_FLOOR_ID and _room_to_floor.get(_room) == OUTSIDE_FLOOR_ID:
                    _eff_rssi -= 15.0
                # Keep best per room
                if _room not in room_scores or _eff_rssi > room_scores[_room]:
                    room_scores[_room] = _eff_rssi

            # ── Merge spatial + RSSI scoring ─────────────────────────────
            # Spatial positioning (Path A) is preferred when available —
            # it uses actual geometry instead of just nearest-scanner.
            # Fall back to RSSI scoring (Path B) when spatial can't resolve.
            _cur_confirmed = self._confirmed_room.get(key)
            if _spatial_candidate:
                # Spatial centroid resolved a position inside a room polygon.
                # This is the primary positioning path — geometry-based.
                # Goes through the vote window like everything else.
                candidate = _spatial_candidate
            elif room_scores:
                # RSSI-only fallback: strongest signal per room with hysteresis
                _best_room = max(room_scores, key=lambda r: room_scores[r])
                if _cur_confirmed and _cur_confirmed in room_scores and _best_room != _cur_confirmed:
                    _hyst = 3.0  # base dBm hysteresis
                    _best_fl = _room_to_floor.get(_best_room, "")
                    _cur_fl = _room_to_floor.get(_cur_confirmed, "")
                    if _best_fl and _cur_fl and _best_fl != _cur_fl:
                        if OUTSIDE_FLOOR_ID in {_best_fl, _cur_fl}:
                            _hyst = 8.0  # indoor↔outdoor
                        else:
                            _hyst = 5.0  # cross-floor
                    else:
                        # Same floor — increase hysteresis for distant rooms
                        _c_cur = self._room_centroids.get(_cur_confirmed)
                        _c_best = self._room_centroids.get(_best_room)
                        if _c_cur and _c_best and _c_cur[2] == _c_best[2]:
                            _dx = _c_cur[0] - _c_best[0]
                            _dy = _c_cur[1] - _c_best[1]
                            _d = math.sqrt(_dx * _dx + _dy * _dy)
                            if not self._use_metres:
                                _d *= 20.0
                            if _d > 6.0:
                                _hyst = 5.0
                    _best_rssi = room_scores.get(_best_room)
                    _cur_rssi = room_scores.get(_cur_confirmed)
                    if _best_rssi is not None and _cur_rssi is not None:
                        if _best_rssi - _cur_rssi < _hyst:
                            candidate = _cur_confirmed
                        else:
                            candidate = _best_room
                    else:
                        candidate = _cur_confirmed if _cur_confirmed else _best_room
                else:
                    candidate = _best_room

        # ── Comprehensive diagnostic for labelled devices ─────────────────────
        _obj_label = (self._known_objs.get(key) or {}).get("user_label")
        if _obj_label:
            # Scanner data: which scanners see this device, their RSSI, position, floor, room
            _scanner_detail = []
            for _src, _rssi in sorted(ema.items(), key=lambda x: -x[1]) if ema else []:
                _sp = self._scanner_positions.get(_src)
                _rm = source_to_area.get(_src, "?")
                _fl = source_to_floor.get(_src, "?") if source_to_floor else "?"
                _pos_str = f"({_sp[0]:.1f},{_sp[1]:.1f})" if _sp else "NO_POS"
                _scanner_detail.append(f"{_src[:18]}={_rssi:.0f}dBm pos={_pos_str} fl={_fl} rm={_rm}")

            # Spatial centroid details
            _spatial_detail = "NONE"
            if _spatial_xy:
                _spatial_detail = f"({_spatial_xy[0]:.1f},{_spatial_xy[1]:.1f}) floor={_spatial_xy[2]} room={_spatial_candidate or 'OUTSIDE_ALL_ROOMS'}"

            # Room geometry check
            _geo_rooms = []
            if _model and _spatial_xy:
                for _rn, _geo in _model.room_geometry_m().items():
                    if isinstance(_geo, dict) and _geo.get("floor_id") == _spatial_xy[2]:
                        _geo_rooms.append(_rn)

            _LOGGER.debug(
                "DIAG [%s] label=%s | scanners(%d): %s",
                key[:30], _obj_label, len(_scanner_detail),
                " | ".join(_scanner_detail[:8]),
            )
            _LOGGER.debug(
                "DIAG [%s] spatial=%s | rooms_on_floor=%s | barriers=%d | "
                "use_metres=%s | scanner_positions=%d | candidate=%s | confirmed=%s",
                key[:30], _spatial_detail,
                ",".join(_geo_rooms) if _geo_rooms else "NONE",
                len(self._rf_barriers),
                self._use_metres, len(self._scanner_positions),
                candidate, _cur_confirmed,
            )
            if room_scores:
                _top5 = sorted(room_scores.items(), key=lambda x: -x[1])[:5]
                _LOGGER.debug(
                    "DIAG [%s] rssi_scores: %s",
                    key[:30],
                    ", ".join(f"{r}={s:.0f}dBm" for r, s in _top5),
                )

        # ── Adaptive tie-break ────────────────────────────────────────────────
        # Adaptive learning is consulted ONLY as a tie-breaker when the
        # Gaussian scorer can't decide (candidate == current because margin
        # wasn't met).  This prevents the learned model from overriding
        # physics — it can only help when physics is ambiguous.
        try:
            _st_ad = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            _d_ad = (_st_ad.data if _st_ad else {}) or {}
            _adaptive_on = bool(_d_ad.get("adaptive_learning_enabled", False))
        except Exception:
            _adaptive_on = False
        if self.suspended:
            _adaptive_on = False

        if _adaptive_on and _live_ema and room_scores and candidate == _cur_confirmed:
            try:
                _ad_store = self.hass.data.get(DOMAIN, {}).get(DATA_ADAPTIVE)
                if _ad_store and _ad_store.maturity() > 0.20:
                    _ad_scores = _ad_store.score_rooms(dict(_live_ema), source_to_area)
                    if _ad_scores:
                        _ad_best = max(_ad_scores, key=lambda r: _ad_scores[r])
                        # Only override if adaptive strongly favors a different room
                        # AND the Gaussian scorer had that room as a close second.
                        # room_scores are dBm; the deficit the adaptive store may
                        # override scales with its maturity — a barely-trained
                        # store only breaks near-exact ties (1 dBm), a fully
                        # mature one may override up to 3 dBm.
                        _ad_rssi_gap = room_scores.get(_ad_best, -999) - room_scores.get(candidate, -999)
                        _ad_max_gap = -(1.0 + 2.0 * _ad_store.maturity())
                        if (_ad_best != candidate
                                and _ad_best in room_scores
                                and _ad_scores.get(_ad_best, 0) > 0.7
                                and _ad_rssi_gap > _ad_max_gap):
                            candidate = _ad_best
            except Exception as _ad_err:
                _LOGGER.warning("Adaptive tie-break error for %s: %s", key[:30], _ad_err, exc_info=True)

        # ── Fingerprint positioning (k-NN or Random Forest) ─────────────────
        # When the user has collected calibration data (>= _KNN_MIN_POINTS),
        # the system can use fingerprint matching instead of (or on top of)
        # the Gaussian model.  k-NN compares the current RSSI vector against
        # calibration points and returns the nearest match with a confidence
        # score.  If confidence >= _KNN_LIVE_THRESHOLD (15%), the fingerprint
        # result overrides the Gaussian candidate.
        #
        # This also provides sub-room positioning (x_frac, y_frac) for the
        # map dot display.  The position is EMA-smoothed to prevent jumping.
        #
        # Room boundary check: the k-NN (x, y) is tested against the correct
        # map's room_bounds (not necessarily the master) since coordinates are
        # in the calibration map's coordinate space.
        try:
            _calib = self.hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
            if _calib and not self.suspended and len(_calib.data.get("points", [])) >= _KNN_MIN_POINTS:
                # Choose algorithm based on setting
                _st2 = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
                _algo = ((_st2.data if _st2 else {}).get("positioning_algorithm") or "knn")
                if _algo == "rf" and _calib.rf_trained:
                    _knn = _calib.rf_locate(dict(_live_ema))
                else:
                    _knn = _calib.knn_locate(dict(_live_ema))
                # Periodic debug log (first object each cycle)
                if not hasattr(self, "_knn_log_count"):
                    self._knn_log_count = 0
                self._knn_log_count += 1
                if self._knn_log_count <= 10 or self._knn_log_count % 50 == 0:
                    _cal_srcs = set()
                    for _cp in _calib.data.get("points", []):
                        for _cr in (_cp.get("scanner_readings") or []):
                            if _cr.get("source"):
                                _cal_srcs.add(_cr["source"])
                    _overlap = set(ema.keys()) & _cal_srcs
                    _LOGGER.debug(
                        "k-NN [%s] addr=%s: ema=%d, cal_src=%d, overlap=%d, "
                        "result=%s, conf=%s, room=%s, positions_stored=%d",
                        key[:30], addr[:20], len(ema), len(_cal_srcs),
                        len(_overlap),
                        "yes" if _knn else "None",
                        _knn.get("confidence") if _knn else "N/A",
                        _knn.get("nearest_room", "") if _knn else "N/A",
                        len(self._knn_position),
                    )
                _knn_conf = _knn.get("confidence", 0.0) if _knn else 0.0
                if _knn and _knn_conf >= _KNN_LIVE_THRESHOLD:
                    _knn_room = _knn.get("nearest_room") or ""
                    # Room boundary check using fabric geometry (metres)
                    if _knn.get("x_m") is not None and _model:
                        _knn_fl = _knn.get("floor_id", "")
                        _geo_room = _model.beacon_room_from_geometry(
                            float(_knn["x_m"]), float(_knn["y_m"]), _knn_fl
                        )
                        if _geo_room:
                            _knn_room = _geo_room
                    # EMA smooth in metre space (floor-based)
                    # Metres only. Smoothing a position in a photo's fraction
                    # space meant the filter's idea of "half a metre" changed
                    # with the picture; and a result with no metres has no
                    # position worth smoothing.
                    if _knn.get("x_m") is None:
                        self._knn_position.pop(key, None)
                        _knn = None
                    if _knn is not None:
                        _raw_x = float(_knn["x_m"])
                        _raw_y = float(_knn["y_m"])
                        _prev_fl = (self._knn_position.get(key) or {}).get("floor_id", "")
                        _new_fl = _knn.get("floor_id", "")
                        if _prev_fl and _prev_fl != _new_fl:
                            self._smooth_xy.pop(key, None)  # new floor → fresh state
                        # α-β filtered (replaces the velocity-aware EMA whose
                        # 0.03 near-stationary alpha froze sub-metre movement)
                        _sx, _sy = self._ab_smooth_xy(self._smooth_xy, key, _raw_x, _raw_y)
                        _knn_smoothed = dict(_knn)
                        _knn_smoothed["x_m"] = round(_sx, 3)
                        _knn_smoothed["y_m"] = round(_sy, 3)
                        self._knn_position[key] = _knn_smoothed
                    # k-NN room override: only when spatial didn't resolve.
                    # Spatial (IDW centroid + room geometry) is the primary
                    # positioning method.  k-NN uses historical calibration
                    # data which may be stale — it should not fight spatial.
                    # k-NN still provides sub-room (x,y) position above.
                    # Guard: the nearest sample's room label must be a REAL
                    # room — device-anchored auto-calibration samples carry
                    # the anchor device's LABEL as their room, and confirming
                    # one teleports the beacon into a phantom room.
                    if _knn_room and _knn_conf >= 0.30 and not _spatial_candidate:
                        _known_rooms = set(self._room_centroids) | set(source_to_area.values())
                        if _knn_room in _known_rooms:
                            candidate = _knn_room
                else:
                    self._knn_position.pop(key, None)
                    self._smooth_xy.pop(key, None)
            else:
                self._knn_position.pop(key, None)
                self._smooth_xy.pop(key, None)
        except Exception as _knn_err:
            _LOGGER.warning("k-NN error for %s: %s", key[:30], _knn_err, exc_info=True)
            self._knn_position.pop(key, None)
            self._smooth_xy.pop(key, None)

        # ── Spatial position: independent from k-NN ─────────────────────
        # Spatial uses real-time RSSI + known scanner geometry.  It writes
        # to its own dict so k-NN failure/success never destroys spatial
        # state and vice versa.  The propagation code prefers spatial over
        # k-NN for dot rendering (spatial is real-time, k-NN can be stale).
        if _spatial_xy:
            _sx_est, _sy_est, _sf_est = _spatial_xy
            # Already α-β smoothed before the room decision — no second pass
            _sp_entry: dict[str, Any] = {
                "x_m": round(_sx_est, 3),
                "y_m": round(_sy_est, 3),
                "floor_id": _sf_est,
                "confidence": rssi_margin_confidence,
                "room": _spatial_candidate or "",
                "source": "spatial",
            }
            # Convert metres to map fracs for rendering
            if _model:
                for _mid, _t in (_model.data.get("map_transforms") or {}).items():
                    if _t.get("floor_id") == _sf_est:
                        _fracs = _model.metres_to_map_frac(_sx_est, _sy_est, _mid)
                        if _fracs and 0.0 <= _fracs[0] <= 1.0 and 0.0 <= _fracs[1] <= 1.0:
                            _sp_entry["x_frac"] = round(_fracs[0], 4)
                            _sp_entry["y_frac"] = round(_fracs[1], 4)
                            _sp_entry["map_id"] = _mid
                            break
            self._spatial_position[key] = _sp_entry
        else:
            # No spatial data — clear stale spatial position
            self._spatial_position.pop(key, None)
            self._spatial_smooth_xy.pop(key, None)

        # ── Store candidate info for diagnostics ─────────────────────────────
        _cand_source = "none"
        if candidate == _spatial_candidate and _spatial_candidate:
            _cand_source = "spatial"
        elif candidate and self._knn_position.get(key) and candidate == (self._knn_position[key].get("room") or self._knn_position[key].get("nearest_room")):
            _cand_source = "knn"
        elif candidate:
            _cand_source = "rssi"
        _rssi_best = max(room_scores, key=lambda r: room_scores[r]) if room_scores else None
        self._last_candidate[key] = {
            "candidate": candidate,
            "source": _cand_source,
            "spatial_room": _spatial_candidate,
            "spatial_xy": _spatial_xy,
            "rssi_best": _rssi_best,
            "rssi_top3": sorted(room_scores.items(), key=lambda x: -x[1])[:3] if room_scores else [],
        }

        # ── Stage 2: majority-vote room confirmation ──────────────────────────
        # ALL candidates (spatial, k-NN, or RSSI-based) go through the vote
        # window.  This provides temporal stabilization — a room must win a
        # majority of recent polls before it becomes the confirmed room.
        existing = self._room_votes.get(key)
        if existing is None or existing.maxlen != vote_window:
            prev = list(existing) if existing else []
            self._room_votes[key] = deque(prev[-vote_window:], maxlen=vote_window)
        votes = self._room_votes[key]

        # Skip None candidates (total signal dropout) — preserves the last
        # known room instead of diluting the window with empty votes.
        if candidate is not None:
            votes.append(candidate)

        # Count votes per room and check if any room meets the threshold
        counts: dict[str, int] = {}
        for v in votes:
            if v:
                counts[v] = counts.get(v, 0) + 1

        confirmed = self._confirmed_room.get(key)
        confidence = 0.0
        if counts:
            # Tie-break: prefer the currently confirmed room over dict order
            top_room = max(counts, key=lambda r: (counts[r], r == confirmed))
            top_count = counts[top_room]
            # Confidence = fraction of the FULL window agreeing on the top
            # room (0.0–1.0).  Divide by window size, not current fill — a
            # single poll after a state reset must not report 1.0 and satisfy
            # the adaptive-learning / scanner-reliability confidence gates.
            confidence = round(top_count / vote_window, 2)
            if top_count >= vote_threshold:
                if top_room != confirmed:
                    # ── Velocity gate ────────────────────────────────────
                    # Three checks prevent teleportation:
                    #  1. Rapid-fire: if device changed rooms very recently,
                    #     require UNANIMOUS vote (all votes agree).
                    #  2. Distance: if rooms are far apart (non-adjacent),
                    #     also require unanimous vote.
                    #  3. Indoor↔outdoor: crossing the outdoor boundary
                    #     always requires unanimous vote.
                    # All checks are soft: they raise the bar for evidence,
                    # not block transitions entirely.
                    _vg_block = False
                    if confirmed is not None:
                        _now_mono = time.monotonic()
                        # Check 1: dwell-proportional transition gate
                        # Short dwell (<30s): require unanimous (just arrived, likely noise)
                        # Medium dwell (30-120s): require supermajority
                        # Long dwell (>120s): normal threshold (device is settled)
                        _last_change = self._last_room_change_mono.get(key, 0.0)
                        _elapsed = _now_mono - _last_change if _last_change else 999.0
                        _dwell = _now_mono - self._room_dwell_start.get(key, 0.0) if self._room_dwell_start.get(key) else 999.0
                        _is_rapid = _dwell < 30.0  # short dwell = high bar
                        # Check 2: room distance (non-adjacent)
                        _is_distant = False
                        _c1 = self._room_centroids.get(confirmed)
                        _c2 = self._room_centroids.get(top_room)
                        if _c1 and _c2:
                            # Centroid-based distance check
                            if _c1[2] == _c2[2]:
                                _dx = _c1[0] - _c2[0]
                                _dy = _c1[1] - _c2[1]
                                _cdist = math.sqrt(_dx * _dx + _dy * _dy)
                                _vg_thresh = _VG_ADJACENT_THRESHOLD_M if self._use_metres else _VG_ADJACENT_THRESHOLD
                                _is_distant = _cdist > _vg_thresh
                            else:
                                _is_distant = True  # different maps → always "distant"
                        elif _model:
                            # Fallback: fabric adjacency list (no map needed)
                            _vg_adj = _model.adjacency()
                            if _vg_adj and confirmed in _vg_adj:
                                _is_distant = top_room not in _vg_adj[confirmed]
                            # else: no adjacency data → _is_distant stays False (no gate)
                        # Check 3: indoor↔outdoor transition
                        _is_outdoor_cross = False
                        _conf_fl = _room_to_floor.get(confirmed, "")
                        _top_fl = _room_to_floor.get(top_room, "")
                        if _conf_fl and _top_fl:
                            _conf_outside = _conf_fl == OUTSIDE_FLOOR_ID
                            _top_outside = _top_fl == OUTSIDE_FLOOR_ID
                            if _conf_outside != _top_outside:
                                _is_outdoor_cross = True

                        # Cross-floor transitions: require higher evidence when dwell is short
                        _is_cross_floor = False
                        if _conf_fl and _top_fl and _conf_fl != _top_fl:
                            _is_cross_floor = True
                        # Determine required vote count based on dwell + context.
                        # When spatial centroid agrees with the new room, relax
                        # requirements — geometry-confirmed transitions shouldn't
                        # need unanimous votes to escape the current room.
                        _spatial_confirms_new = (_spatial_candidate == top_room) if _spatial_candidate else False
                        if _is_outdoor_cross:
                            _required = len(votes) if not _spatial_confirms_new else vote_threshold
                        elif _is_cross_floor and _dwell < 60.0:
                            _required = len(votes) if not _spatial_confirms_new else vote_threshold + 1
                        elif _is_rapid or _is_distant:
                            _required = len(votes) if not _spatial_confirms_new else vote_threshold
                        elif _is_cross_floor and _dwell < 120.0:
                            _required = min(len(votes), vote_threshold + 1)
                        else:
                            _required = vote_threshold  # normal
                        if top_count < _required:
                            _vg_block = True
                            _LOGGER.debug(
                                "Velocity gate blocked %s: %s → %s (dwell=%.0fs, rapid=%s, distant=%s, cross_floor=%s, votes=%d/%d need %d)",
                                key[:30], confirmed, top_room, _dwell,
                                _is_rapid, _is_distant, _is_cross_floor, top_count, len(votes), _required,
                            )
                    if not _vg_block:
                        _LOGGER.debug(
                            "Room confirmed for %s: %s → %s (votes %s, confidence %.0f%%)",
                            key, confirmed, top_room, dict(counts), confidence * 100,
                        )
                        # Track room change for alert processing
                        self._pending_room_changes.append((key, confirmed, top_room))
                        _change_mono = time.monotonic()
                        self._last_room_change_mono[key] = _change_mono
                        self._room_dwell_start[key] = _change_mono
                        # Floor transition learning
                        _old_fl = _room_to_floor.get(confirmed, "")
                        _new_fl = _room_to_floor.get(top_room, "")
                        if _old_fl and _new_fl and _old_fl != _new_fl:
                            _fl_dwell = _change_mono - self._floor_dwell_start.get(key, _change_mono)
                            self._floor_dwell_start[key] = _change_mono
                            self._device_floor[key] = _new_fl
                            # Record to adaptive store for learning
                            try:
                                _ad = self.hass.data.get(DOMAIN, {}).get(DATA_ADAPTIVE)
                                if _ad:
                                    _ad.record_floor_transition(_old_fl, _new_fl, _fl_dwell)
                            except Exception:
                                pass
                        elif _new_fl:
                            self._device_floor[key] = _new_fl
                        confirmed = top_room

        self._confirmed_room[key] = confirmed
        self._room_confidence[key] = confidence
        self._rssi_margin_confidence[key] = rssi_margin_confidence

        # ── Phase 3: per-scanner reliability update ──────────────────────────
        # Only learn reliability when we're VERY confident the confirmed room
        # is correct: high vote confidence AND spatial centroid agrees.
        # This prevents the negative feedback loop where a wrong room assignment
        # poisons scanner reliability scores, making it impossible to recover.
        # Skip when suspended — don't pollute reliability with potentially wrong data.
        _spatial_agrees = (_spatial_candidate == confirmed) if _spatial_candidate else False
        if confirmed and confidence >= 0.9 and _spatial_agrees and ema and not self.suspended:
            for _src in ema:
                _src_room = source_to_area.get(_src)
                if not _src_room:
                    continue
                _agreed = (_src_room == confirmed)
                _q = self._scanner_agree.get(_src)
                if _q is None:
                    _q = deque(maxlen=_RELIABILITY_WINDOW)
                    self._scanner_agree[_src] = _q
                _q.append(_agreed)
                if len(_q) >= _RELIABILITY_MIN_POLLS:
                    _agree_rate = sum(_q) / len(_q)
                    _disagree = 1.0 - _agree_rate
                    _w = 1.0 / (1.0 + _disagree)
                    self._scanner_reliability[_src] = max(_RELIABILITY_FLOOR, round(_w, 3))
                else:
                    self._scanner_reliability[_src] = 1.0

        # ── Adaptive learning: record observation ────────────────────────────
        # Feed confirmed room assignments back into the adaptive store so it
        # can improve over time.  Only record from identified devices (phones
        # with IRK, labelled objects) — random BLE devices at random positions
        # inflate variance and make the fingerprint useless.
        # Also require confidence >= 0.7 (stable) and rate-limit to 1 per
        # device per 5 min to keep data compact.  Beyond that, three quality
        # gates (dwell stability, novelty, ground-truth corroboration) keep
        # self-reinforcing or redundant observations out of the fingerprints
        # — see _adaptive_obs_quality_ok.
        _obj_for_adaptive = self._known_objs.get(key, {})
        _is_identified_device = bool(
            _obj_for_adaptive.get("user_label")
            or _obj_for_adaptive.get("identified")
            or _obj_for_adaptive.get("kind") == "private_ble"  # phone with IRK
        )
        if _adaptive_on and confirmed and confidence >= 0.7 and _live_ema and _is_identified_device:
            try:
                _now_mono = time.monotonic()
                _last = self._adaptive_last_obs.get(key, 0.0)
                if (_now_mono - _last >= 300.0
                        and self._adaptive_obs_quality_ok(key, confirmed, dict(_live_ema), _now_mono)):
                    self._adaptive_last_obs[key] = _now_mono
                    self._adaptive_last_vec[key] = dict(_live_ema)
                    _ad = self.hass.data.get(DOMAIN, {}).get(DATA_ADAPTIVE)
                    if _ad:
                        # Derive floor of confirmed room
                        _conf_floor = None
                        if source_to_floor:
                            for _src, _area in source_to_area.items():
                                if _area == confirmed and _src in (source_to_floor or {}):
                                    _conf_floor = source_to_floor[_src]
                                    break
                        _ad.observe(confirmed, _conf_floor, dict(_live_ema), source_to_area, source_to_floor or {})
                        # Record transitions
                        for _chg_key, _old, _new in self._pending_room_changes:
                            if _chg_key == key:
                                _ad.record_transition(_old, _new)
                        # Periodic save (every 20 observations, not every poll).
                        # call_soon_threadsafe because _smooth_room runs on the
                        # compute-executor thread in single/dedicated CPU mode —
                        # async_create_task straight from a thread is not allowed.
                        self._adaptive_save_counter += 1
                        if self._adaptive_save_counter >= 20:
                            self._adaptive_save_counter = 0
                            self.hass.loop.call_soon_threadsafe(
                                self.hass.async_create_task, _ad.async_save_periodic())
            except Exception as _obs_err:
                _LOGGER.warning("Adaptive observe error for %s: %s", key[:30], _obs_err, exc_info=True)

        return confirmed

    # ── Position smoothing (α-β constant-velocity filter) ────────────────

    def _ab_smooth_xy(
        self, store: dict[str, tuple], key: str, x: float, y: float
    ) -> tuple[float, float]:
        """Smooth an x/y estimate with a 2D α-β (constant-velocity) filter.

        Replaces the fixed/velocity-gated EMAs: an EMA either lags a walking
        target (~60 s convergence at alpha 0.15 / 0.1 Hz) or freezes
        sub-metre movement entirely (alpha 0.03).  The α-β filter carries a
        velocity state so it follows walking motion yet still damps
        stationary jitter.  Velocity is clamped to a fast walk (2.5 m/s);
        state lives in `store` as (x, y, vx, vy) per object key.
        """
        _dt = max(1.0, self.update_interval.total_seconds())
        st = store.get(key)
        if not st or len(st) < 4:
            store[key] = (x, y, 0.0, 0.0, 0)
            return x, y
        px, py, vx, vy = st[0], st[1], st[2], st[3]
        rejected = st[4] if len(st) > 4 else 0
        pred_x = px + vx * _dt
        pred_y = py + vy * _dt
        rx = x - pred_x
        ry = y - pred_y

        # ── Plausibility gate ────────────────────────────────────────────────
        # This was the one stage of the pipeline with no outlier rejection.
        # RSSI has a Kalman covariance and a silence grace; rooms have to win a
        # vote window. Position accepted HALF of any residual unconditionally
        # (_A below), so a spurious 8 m jump moved the dot 4 m on the spot —
        # and because the same residual drives the velocity term, one bad
        # measurement also handed the dot momentum in the wrong direction and
        # it carried on travelling on the next poll. The 2.5 m/s clamp bounds
        # the velocity STATE; it never bounded the step.
        #
        # A residual implies an apparent speed. Above what the thing being
        # tracked can physically do, that is not evidence of movement — it is
        # evidence the measurement is bad, and the honest response is to coast
        # on the prediction and wait, exactly as the RSSI stage holds a value
        # through a missed poll instead of believing the silence.
        #
        # Bounded stubbornness: a device switched off and carried elsewhere
        # really does teleport, so after _XY_JUMP_TOLERATE consecutive
        # rejections the measurement is accepted and the filter re-seeds there.
        apparent_speed = math.hypot(rx, ry) / _dt
        if apparent_speed > _XY_JUMP_SPEED_MS and rejected < _XY_JUMP_TOLERATE:
            store[key] = (pred_x, pred_y, vx, vy, rejected + 1)
            return pred_x, pred_y
        if apparent_speed > _XY_JUMP_SPEED_MS:
            # Believed at last: re-seed rather than easing toward it, because
            # the velocity state describes a journey that never happened.
            store[key] = (x, y, 0.0, 0.0, 0)
            return x, y

        _A = 0.5   # position gain
        _B = 0.15  # velocity gain
        nx = pred_x + _A * rx
        ny = pred_y + _A * ry
        nvx = vx + (_B / _dt) * rx
        nvy = vy + (_B / _dt) * ry
        _spd = math.hypot(nvx, nvy)
        if _spd > 2.5:
            nvx *= 2.5 / _spd
            nvy *= 2.5 / _spd
        store[key] = (nx, ny, nvx, nvy, 0)
        return nx, ny

    # ── Adaptive observation quality gates ───────────────────────────────

    def _adaptive_obs_quality_ok(
        self, key: str, room: str, ema: dict[str, float], now_mono: float
    ) -> bool:
        """Quality gates for adaptive-learning observations.

        The adaptive store learns from the system's own confirmed rooms, so
        a wrong-but-confident assignment reinforces itself.  These gates keep
        low-quality observations out of the fingerprints:

        1. Dwell stability — the device must have been in its confirmed room
           for >= 2 min; mid-transition polls pollute fingerprints.  A device
           with no recorded room change (stationary since startup) passes.
        2. Novelty — skip if the RSSI vector is nearly identical to the last
           RECORDED observation; a tag parked on a charger must not collapse
           the room fingerprint to that one spot (the fingerprint EMA window
           is only ~20 samples).
        3. Ground truth — if the room's HA area has motion/occupancy/presence
           sensors, one must corroborate.  Rooms without such sensors record
           as before (no evidence either way is not counted against).
        """
        _dwell_start = self._room_dwell_start.get(key)
        if _dwell_start and now_mono - _dwell_start < 120.0:
            return False

        _prev = self._adaptive_last_vec.get(key)
        if _prev and set(_prev) == set(ema) and all(
            abs(ema[s] - _prev[s]) < 2.0 for s in ema
        ):
            return False

        return self._room_corroborated(room) is not False

    def _room_corroborated(self, room: str) -> bool | None:
        """Check for independent HA evidence that a person is in `room`.

        Returns True if a motion/occupancy/presence binary_sensor in the
        room's area is 'on' (or switched off within the last 30 s), False if
        such sensors exist but none corroborate, None if the area has no such
        sensors.  Fails open (None) on registry errors — never block learning
        on lookup problems.
        """
        try:
            _area = next(
                (a for a in ar.async_get(self.hass).async_list_areas()
                 if (a.name or "").strip().lower() == room.strip().lower()),
                None,
            )
            if _area is None:
                return None
            _ent_reg = er.async_get(self.hass)
            # Entities assigned to the area directly, plus entities that
            # inherit the area from their device.
            _entity_ids = {
                e.entity_id for e in er.async_entries_for_area(_ent_reg, _area.id)
            }
            for _dev in dr.async_entries_for_area(dr.async_get(self.hass), _area.id):
                for e in er.async_entries_for_device(_ent_reg, _dev.id):
                    if e.area_id is None:
                        _entity_ids.add(e.entity_id)

            _found_sensor = False
            for _eid in _entity_ids:
                if not _eid.startswith("binary_sensor."):
                    continue
                _state = self.hass.states.get(_eid)
                if _state is None:
                    continue
                if _state.attributes.get("device_class") not in (
                    "motion", "occupancy", "presence",
                ):
                    continue
                _found_sensor = True
                if _state.state == "on":
                    return True
                # Recently cleared counts too — motion sensors switch off
                # while the person is still in the room.
                if _state.state == "off":
                    _age = time.time() - _state.last_changed.timestamp()
                    if _age <= 30.0:
                        return True
            return False if _found_sensor else None
        except Exception as _corr_err:
            _LOGGER.debug("Corroboration check for %s failed: %s", room, _corr_err)
            return None

    # ── Object state cleanup ─────────────────────────────────────────────

    def _evict_object(self, key: str) -> None:
        """Remove all cached state for a single object key.

        Called when an object has been stale longer than _STALE_EVICT_S, or
        explicitly via clear_object_state().  Cleans up Kalman, vote, k-NN,
        confidence, and alert state to prevent unbounded memory growth.
        """
        self._known_objs.pop(key, None)
        self._last_seen.pop(key, None)
        self._away_miss.pop(key, None)
        self._room_votes.pop(key, None)
        self._confirmed_room.pop(key, None)
        self._room_confidence.pop(key, None)
        self._rssi_margin_confidence.pop(key, None)
        self._knn_position.pop(key, None)
        self._smooth_xy.pop(key, None)
        self._spatial_position.pop(key, None)
        self._spatial_smooth_xy.pop(key, None)
        self._beacon_autocal_last.pop(key, None)
        self._adaptive_last_obs.pop(key, None)
        self._adaptive_last_vec.pop(key, None)
        self._last_room_change_mono.pop(key, None)
        self._room_dwell_start.pop(key, None)
        self._floor_dwell_start.pop(key, None)
        self._device_floor.pop(key, None)
        self._alert_last_sent.pop(key, None)
        self._last_candidate.pop(key, None)
        self._spatial_debug.pop(key, None)
        self._floor_evidence.pop(key, None)
        self._ema_rssi.pop(key, None)
        self._kalman_p.pop(key, None)
        self._silence_miss.pop(key, None)
        # Kalman state for ble/private_ble is keyed by (RPA-resolved) address,
        # not the object key — pop that too or a returning device resurrects
        # its pre-departure RSSI and transient devices leak state forever.
        _addr = self._kalman_addr_key.pop(key, None)
        if _addr and _addr != key:
            self._ema_rssi.pop(_addr, None)
            self._kalman_p.pop(_addr, None)
            self._silence_miss.pop(_addr, None)

    def _rekey_kalman_state(self, key: str, smooth_addr: str) -> None:
        """Point an object's Kalman state at ``smooth_addr``, dropping any orphan.

        The RSSI smoothing dicts are keyed by (RPA-resolved) address, not object
        key, so ``_kalman_addr_key`` records the current mapping.  When the
        mapping changes — the RPA resolver flaps, or a rotation is seen before
        the resolver has it and falls back to the raw MAC — the superseded
        address's entries are unreachable: `_evict_object` only ever pops the
        *current* mapping, so they would leak for the process lifetime, one per
        change.  Drop them here; the state re-seeds on the next poll.
        """
        prev_addr = self._kalman_addr_key.get(key)
        if prev_addr and prev_addr not in (smooth_addr, key):
            self._ema_rssi.pop(prev_addr, None)
            self._kalman_p.pop(prev_addr, None)
            self._silence_miss.pop(prev_addr, None)
        self._kalman_addr_key[key] = smooth_addr

    def clear_object_state(self, key: str) -> None:
        """Public API: clear all coordinator state for an object.

        Called when a beacon is removed from beacon tune or an object
        is unfollowed — ensures the object won't linger as stale.
        """
        self._evict_object(key)
        # Also try uppercase variant (keys may differ in case)
        ku = key.upper()
        if ku != key:
            self._evict_object(ku)
        _LOGGER.debug("Cleared coordinator state for %s", key)

    # ── PadSpan automations ─────────────────────────────────────────────────

    async def _run_automations(
        self, arrived: set[str], departed: set[str], result: dict[str, Any]
    ) -> None:
        """Fire HA events and execute PadSpan automation rules for arrive/depart."""
        # Build key→label lookup
        _obj_store = self.hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
        _key_labels: dict[str, str] = {}
        for k, obj in result.items():
            lbl = obj.get("user_label") or ""
            if lbl:
                _key_labels[k] = lbl
        if _obj_store:
            for k, entry in _obj_store.all().items():
                if isinstance(entry, dict) and entry.get("label"):
                    _key_labels[str(k)] = entry["label"]

        # ── Fire HA events for labelled arrive/depart ────────────────────
        # These events can be used as triggers in HA automations.  Only
        # labelled (user-tagged) devices fire: every rotating-MAC rotation in
        # a busy BLE environment registers as a "new" unlabelled arrival, and
        # firing those flooded the event bus until subscribers hit HA's
        # 4096-pending-message limit and were disconnected.  PadSpan's own
        # automation rules below match on the raw arrived/departed sets, so
        # rules keyed to an unlabelled device still run.
        for key in arrived:
            label = _key_labels.get(key, "")
            if not label:
                continue
            room = (result.get(key) or {}).get("room", "")
            self.hass.bus.async_fire("padspan_device_arrived", {
                "device_key": key, "label": label, "room": room,
            })
            _LOGGER.info("Device arrived: %s (%s) in %s", label, key[:30], room)
        for key in departed:
            label = _key_labels.get(key, "")
            if not label:
                continue
            self.hass.bus.async_fire("padspan_device_departed", {
                "device_key": key, "label": label,
            })
            _LOGGER.info("Device departed: %s (%s)", label, key[:30])

        # ── Execute PadSpan automation rules ─────────────────────────────
        try:
            _st = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            rules = (_st.data if _st else {}).get("padspan_automations") or []
        except Exception:
            return
        if not rules:
            return

        for rule in rules:
            if not isinstance(rule, dict) or not rule.get("enabled", True):
                continue
            trigger = rule.get("trigger")  # "arrive" or "depart"
            device_key = rule.get("device_key", "")
            device_label = rule.get("device_label", "")
            action = rule.get("action", "")  # "turn_on" or "turn_off"
            entity_id = rule.get("entity_id", "")
            if not trigger or not entity_id or not action:
                continue

            # Match by key or label
            _matched_keys: set[str] = set()
            if device_key:
                _matched_keys.add(device_key)
            if device_label:
                for k, lbl in _key_labels.items():
                    if lbl.upper() == device_label.upper():
                        _matched_keys.add(k)

            # Check trigger
            _fire = False
            if trigger == "arrive" and _matched_keys & arrived:
                _fire = True
            elif trigger == "depart" and _matched_keys & departed:
                _fire = True

            if _fire:
                parts = entity_id.split(".", 1)
                if len(parts) == 2:
                    svc_domain, _ = parts
                    try:
                        await self.hass.services.async_call(
                            svc_domain, action, {"entity_id": entity_id}
                        )
                        _LOGGER.info(
                            "PadSpan automation: %s %s → %s.%s(%s)",
                            trigger, device_label or device_key,
                            svc_domain, action, entity_id,
                        )
                    except Exception as _svc_err:
                        _LOGGER.warning(
                            "PadSpan automation failed: %s → %s",
                            rule, _svc_err,
                        )

    # ── Beacon auto-calibration ────────────────────────────────────────────

    async def _inject_beacon_calibration(
        self, now: float, pinned: dict[str, dict], result: dict[str, Any]
    ) -> None:
        """Auto-inject calibration points from pinned beacons that have live RSSI.

        Beacons with known map positions act as continuous calibration sources:
        since we know exactly where they are, their RSSI readings become new
        fingerprint data points.  Rate-limited to one injection per beacon per
        10 minutes to avoid flooding the calibration store.
        """
        try:
            _st = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            if _st:
                _auto_cal = _st.data.get("beacon_auto_calibrate", True)
                _adaptive = _st.data.get("adaptive_learning_enabled", False)
                # Auto-calibrate if either beacon_auto_calibrate or adaptive_learning is on
                if not _auto_cal and not _adaptive:
                    return
        except Exception:
            pass

        cal_store = self.hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
        if not cal_store:
            return

        _AUTOCAL_INTERVAL = 600.0  # 10 minutes between injections per beacon

        for key, pin in pinned.items():
            obj = result.get(key)
            if not obj or obj.get("_stale"):
                continue
            # Rate limit: at most 1 injection per beacon per 10 minutes
            last_ts = self._beacon_autocal_last.get(key, 0.0)
            if now - last_ts < _AUTOCAL_INTERVAL:
                continue
            # Need smoothed per-source RSSI
            smoothed_rssi: dict[str, float] = obj.get("_source_rssi") or {}
            if not smoothed_rssi:
                continue
            self._beacon_autocal_last[key] = now
            try:
                await cal_store.async_add_point({
                    "map_id": "",
                    "x_frac": 0.5,
                    "y_frac": 0.5,
                    "x_m": pin.get("x_m"),
                    "y_m": pin.get("y_m"),
                    "floor_id": pin.get("floor_id", ""),
                    "room": pin.get("room", ""),
                    "label": f"[auto] {obj.get('user_label') or key}",
                    "device_id": key,
                    "duration_s": 10,
                    "scanner_readings": [
                        {"source": src, "rssi_samples": [rssi]}
                        for src, rssi in smoothed_rssi.items()
                    ],
                })
                await cal_store.async_prune_auto_points(max_per_beacon=50)
            except Exception:
                _LOGGER.debug("Beacon auto-cal injection failed for %s", key)

    async def inject_immediate_calibration(
        self, beacons: list[dict], map_id: str, floor_id: str, room_bounds: dict
    ) -> int:
        """Inject calibration points for beacons with live RSSI.

        Uses fabric beacon positions (metres) when available.
        Falls back to map fracs from beacon dict.
        """
        cal_store = self.hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
        if not cal_store:
            return 0
        _model = self.hass.data.get(DOMAIN, {}).get(DATA_MODEL)

        injected = 0
        now = time.monotonic()
        for bk in beacons:
            key = bk.get("key", "")
            if not key:
                continue
            smoothed_rssi = dict(self._ema_rssi.get(key, {}))
            if not smoothed_rssi:
                smoothed_rssi = dict(self._ema_rssi.get(key.upper(), {}))
            if not smoothed_rssi:
                obj = self._known_objs.get(key) or {}
                smoothed_rssi = obj.get("_source_rssi") or {}
            if not smoothed_rssi:
                continue
            self._beacon_autocal_last[key] = now
            _pt: dict[str, Any] = {
                "floor_id": floor_id,
                "label": f"[auto] {(self._known_objs.get(key) or {}).get('user_label') or key}",
                "device_id": key,
                "duration_s": 10,
                "scanner_readings": [
                    {"source": src, "rssi_samples": [rssi]}
                    for src, rssi in smoothed_rssi.items()
                ],
            }
            # Fabric beacon position (metres, primary)
            _fb = (_model.beacon_positions_m().get(key) or {}) if _model else {}
            if _fb and _fb.get("x_m") is not None:
                _pt["x_m"] = _fb["x_m"]
                _pt["y_m"] = _fb["y_m"]
                _pt["room"] = _fb.get("room", "")
                _pt["x_frac"] = 0.5
                _pt["y_frac"] = 0.5
                _pt["map_id"] = ""
            elif bk.get("x") is not None:
                _pt["map_id"] = map_id
                _pt["x_frac"] = float(bk.get("x", 0))
                _pt["y_frac"] = float(bk.get("y", 0))
                _pt["room"] = _fb.get("room", "")
            else:
                continue
            try:
                await cal_store.async_add_point(_pt)
                await cal_store.async_prune_auto_points(max_per_beacon=50)
                injected += 1
            except Exception:
                _LOGGER.debug("Immediate beacon cal injection failed for %s", key)
        return injected

    # ── Follow-alert processing ────────────────────────────────────────────

    async def _process_room_alerts(
        self, now: float, result: dict[str, Any]
    ) -> None:
        """Send notifications for room changes based on Follow tab alert configs.

        Supports both legacy HA notify services (notify.{name}) and the newer
        entity-based notify (notify.send_message with entity_id).  Falls back
        to auto-detecting an available service, preferring email/SMTP ones.
        Rate-limited to one alert per device per 60 seconds.
        """
        from .const import DOMAIN, DATA_ALERTS

        alert_store = self.hass.data.get(DOMAIN, {}).get(DATA_ALERTS)
        if not alert_store:
            return

        for key, old_room, new_room in self._pending_room_changes:
            try:
                cfg = alert_store.get_config(key)
                if not cfg:
                    # UI saves alert config under address (e.g. "AA:BB:CC:DD:EE:FF")
                    # but key is prefixed (e.g. "ble:AA:BB:CC:DD:EE:FF"). Try address.
                    _obj = result.get(key) or self._known_objs.get(key) or {}
                    _addr = _obj.get("address") or ""
                    if _addr:
                        cfg = alert_store.get_config(_addr)
                if not cfg:
                    continue
                email = (cfg.get("email") or "").strip()
                if not email:
                    continue
                if not cfg.get("on_room_change"):
                    continue

                # Check watch_rooms filter (empty list = alert on all rooms)
                watch = cfg.get("watch_rooms") or []
                if watch and new_room not in watch:
                    continue

                # Rate limit: 60s cooldown per device
                last = self._alert_last_sent.get(key, 0.0)
                if now - last < 60:
                    _LOGGER.debug("Alert throttled for %s (%.0fs since last)", key, now - last)
                    continue

                # Get display label
                obj = result.get(key) or self._known_objs.get(key) or {}
                label = obj.get("user_label") or obj.get("name") or key

                # Find a notify service — prefer user-configured, fall back to first available
                # Supports both legacy notify.{name} and new HA 2024+ entity-based notify
                services = self.hass.services.async_services().get("notify", {})
                has_send_message = "send_message" in services
                entity_ids = [s.entity_id for s in self.hass.states.async_all("notify")]
                legacy = [k for k in services if k != "send_message"]

                if not services and not entity_ids:
                    _LOGGER.warning("Alert: no notify services available in HA")
                    continue

                preferred = cfg.get("notify_service") or ""

                message = (
                    f"{label} moved from {old_room or 'unknown'} to {new_room}"
                )
                alert_data: dict[str, Any] = {
                    "title": f"PadSpan: {label} moved",
                    "message": message,
                }
                sent = False
                # Try entity-based send_message first if applicable
                if preferred.startswith("notify.") and has_send_message:
                    try:
                        payload = {**alert_data, "entity_id": preferred}
                        if email:
                            payload["target"] = email
                        await self.hass.services.async_call("notify", "send_message", payload)
                        sent = True
                    except Exception:
                        # Fall through to legacy
                        pass
                if not sent and preferred and preferred in services:
                    try:
                        await self.hass.services.async_call(
                            "notify", preferred, {**alert_data, "target": email} if email else alert_data,
                        )
                        sent = True
                    except Exception:
                        try:
                            await self.hass.services.async_call("notify", preferred, alert_data)
                            sent = True
                        except Exception:
                            pass
                if not sent:
                    # Auto-pick: prefer entity with mail/smtp, then legacy, then first available
                    auto_targets: list[tuple[str, str, dict[str, Any]]] = []
                    for eid in entity_ids:
                        if has_send_message:
                            auto_targets.append(("send_message", eid, {**alert_data, "entity_id": eid}))
                    for svc in legacy:
                        auto_targets.append((svc, svc, alert_data))
                    # Sort: prefer mail/smtp
                    auto_targets.sort(key=lambda t: (0 if "mail" in t[1].lower() or "smtp" in t[1].lower() else 1))
                    for svc_name, _label, payload in auto_targets:
                        try:
                            await self.hass.services.async_call("notify", svc_name, payload)
                            sent = True
                            break
                        except Exception:
                            continue
                if sent:
                    self._alert_last_sent[key] = now
                    _LOGGER.info(
                        "Follow alert sent for %s: %s → %s (to %s via %s)",
                        label, old_room, new_room, email, preferred or "auto",
                    )
                else:
                    _LOGGER.warning("Follow alert: all send attempts failed for %s", label)
            except Exception as err:
                _LOGGER.warning("Follow alert failed for %s: %s", key, err)

    def clear_scanner(self, source: str) -> int:
        """Remove a scanner from all devices' Kalman filter state.

        Called when a scanner is removed or reset.  Without this, stale RSSI
        entries for the removed scanner would decay slowly via the silence
        mechanism, potentially biasing room scores during that window.
        Returns the number of device entries that were cleaned.
        """
        cleared = 0
        for addr in list(self._ema_rssi):
            if source in self._ema_rssi[addr]:
                del self._ema_rssi[addr][source]
                self._kalman_p.get(addr, {}).pop(source, None)
                cleared += 1
                if not self._ema_rssi[addr]:
                    del self._ema_rssi[addr]
                    self._kalman_p.pop(addr, None)
        for addr in list(self._silence_miss):
            if source in self._silence_miss[addr]:
                del self._silence_miss[addr][source]
                if not self._silence_miss[addr]:
                    del self._silence_miss[addr]
        return cleared

    async def _record_movement(self, result: dict[str, Any]) -> None:
        """Persist room transitions to the movement history store.

        Movement history powers the Follow tab's movement log and the
        Manage → History view.  Each transition is recorded with a timestamp,
        the object's display label, and the old/new room names.
        """
        from .const import DOMAIN, DATA_MOVEMENT, DATA_OBJECTS, DATA_DEVICE_REGISTRY
        try:
            mv_store = self.hass.data.get(DOMAIN, {}).get(DATA_MOVEMENT)
            if not mv_store:
                return
            obj_store = self.hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
            dev_reg = self.hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
            for key, old_room, new_room in self._pending_room_changes:
                label = None
                pid = None
                if dev_reg:
                    pid = dev_reg.resolve(key)
                    if pid:
                        label = dev_reg.get_label(pid)
                if not label and obj_store:
                    label = obj_store.get_label(key)
                await mv_store.record(key, old_room, new_room, label=label, padspan_id=pid)
        except Exception as err:
            _LOGGER.debug("Movement recording failed: %s", err)
