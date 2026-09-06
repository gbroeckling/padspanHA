# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
Anchored-beacon drift (gap #6, best-in-class roadmap): a pinned beacon
declares a TRUE fabric position (model.py's beacon_positions_m); the solver
keeps computing a SOLVED position for it every poll exactly like any other
object (presence_coordinator.py's pinned-beacon block only ever overrides
room, never x_m/y_m — verified before writing this). The gap between solved
and true is the one thing a one-off calibration walk point can never give:
a continuously live-refreshed ground-truth check on the solve itself.

Pure — no HA dependency.
"""

import math

# Indoor BLE positioning's own noise floor is roughly 1-3 m even with a
# healthy calibration (this session's LOO cross-validation tooling reports
# accuracy in that band) — drift inside it is normal jitter, not a fault.
DRIFT_WARN_M = 2.0
DRIFT_BAD_M = 5.0


def compute_drift_m(
    solved_x_m: float | None,
    solved_y_m: float | None,
    true_x_m: float | None,
    true_y_m: float | None,
) -> float | None:
    """Distance between where the solver placed a pinned beacon and where
    it is declared to actually be. None when either position is unknown —
    never a fabricated zero."""
    if solved_x_m is None or solved_y_m is None or true_x_m is None or true_y_m is None:
        return None
    return round(math.hypot(solved_x_m - true_x_m, solved_y_m - true_y_m), 2)


def drift_severity(drift_m: float | None) -> str:
    """"ok" | "warn" | "bad" | "unknown" — a sustained "bad" over many polls
    (not one noisy sample) is the actual signal: the beacon moved, its
    declared position was wrong to begin with, or something is jamming/
    spoofing its scanners. This function judges one sample; persistence is
    the caller's job."""
    if drift_m is None:
        return "unknown"
    if drift_m <= DRIFT_WARN_M:
        return "ok"
    if drift_m <= DRIFT_BAD_M:
        return "warn"
    return "bad"
