# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
Adaptive Learning Store
========================
Passively learns room RSSI fingerprints, transition patterns, and cross-floor
attenuation from high-confidence confirmed room assignments.  All statistics
use Welford's online algorithm (running mean + variance) so the store stays
compact regardless of how long learning runs.

Stored in .storage/padspan_ha.adaptive.
"""

import logging
import math
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import ADAPTIVE_STORE_KEY

_LOGGER = logging.getLogger(__name__)

# How many observations before adaptive scoring reaches full influence
_MATURITY_OBS = 2000
# Minimum observations per room-scanner pair before using it for scoring
_MIN_PAIR_OBS = 10
# Minimum total transition count from a room before using priors
_MIN_TRANSITIONS = 20
# Maximum avg variance per room before we stop trusting its fingerprint.
# Variance > 50 means std dev > 7 dBm — the fingerprint is too noisy to
# distinguish rooms and adds harmful noise to positioning.
_MAX_USEFUL_VARIANCE = 50.0
# Exponential decay alpha for fingerprint EMA — effective window ~20 samples.
# Higher = faster adaptation to changes, lower = smoother but slower to adapt.
_EMA_DECAY_ALPHA = 0.05
# Fingerprint schema version.  v2 = per-device normalized RSSI (each scanner
# reading is stored relative to the device's mean across scanners), making
# fingerprints comparable across devices with different TX power.  v1 raw-dBm
# fingerprints are incompatible and are reset on load.
_FP_VERSION = 2
# Minimum scanners per observation/query — a single-scanner vector normalizes
# to all-zero and carries no room information.
_MIN_OBS_SCANNERS = 2


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _empty_data() -> dict[str, Any]:
    return {
        "fp_version": _FP_VERSION,
        "room_fingerprints": {},
        "transition_counts": {},
        "floor_pairs": {},
        "floor_transitions": {},  # "fromFloor|toFloor" → Welford stats of dwell_s + count
        "stats": {
            "total_observations": 0,
            "learning_since": None,
            "days_active": 0,
        },
    }


@dataclass
class AdaptiveStore:
    hass: HomeAssistant
    store: Store
    # default_factory is never actually invoked: __init__ below is defined
    # explicitly in the class body, so @dataclass skips generating its own
    # and this field's default machinery goes unused (data is set directly
    # in __init__ instead). Kept for the type annotation and because the
    # same pattern already exists elsewhere in this codebase (e.g.
    # CalibrationStore) — harmless, just not what it looks like at a glance.
    data: dict[str, Any] = field(default_factory=_empty_data)

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.store = Store(hass, 1, ADAPTIVE_STORE_KEY)
        self.data = _empty_data()

    async def async_load(self) -> dict[str, Any]:
        loaded = await self.store.async_load()
        if isinstance(loaded, dict) and "room_fingerprints" in loaded:
            self.data = loaded
        else:
            self.data = _empty_data()
        # Fingerprint schema check — MUST run before the key backfill below,
        # which would stamp the current version onto old data.  v1 raw-dBm
        # fingerprints are incompatible with v2 normalized ones; reset them.
        # transition_counts and floor_pairs survive (floor_pair deltas are
        # already device-relative).
        if self.data.get("fp_version") != _FP_VERSION:
            if self.data.get("room_fingerprints"):
                _LOGGER.info(
                    "Adaptive room fingerprints reset (schema v%s → v%s: "
                    "per-device RSSI normalization) — relearning from scratch",
                    self.data.get("fp_version", 1), _FP_VERSION,
                )
                self.data["room_fingerprints"] = {}
            self.data["fp_version"] = _FP_VERSION
        # Schema migration: ensure all keys exist (added in later versions)
        for key, default in _empty_data().items():
            if key not in self.data:
                self.data[key] = default
        return self.data

    async def _save(self) -> None:
        await self.store.async_save(self.data)

    # ── Exponentially-weighted online update ─────────────────────────────────

    @staticmethod
    def _welford_update(
        existing: dict[str, float], new_val: float
    ) -> dict[str, float]:
        """Update running mean/variance with exponential decay.

        Uses an EMA-style update so recent observations dominate and stale
        data fades out naturally.  The effective window is ~1/alpha samples
        (alpha=0.05 → ~20 most recent observations matter).  This prevents
        variance from inflating indefinitely as the environment changes.

        Still tracks 'n' for minimum-observation gating but the mean/var
        are no longer equally-weighted across all history.
        """
        n = existing.get("n", 0) + 1
        old_mean = existing.get("mean", 0.0)
        old_var = existing.get("var", 0.0)
        # Alpha controls decay rate: higher = faster adaptation, noisier.
        # 0.05 → effective window of ~20 observations.
        alpha = _EMA_DECAY_ALPHA
        _ts = round(time.time(), 1)  # last-updated, for staleness gating
        if n <= 1:
            # First observation — seed directly
            return {"mean": round(new_val, 3), "var": 0.0, "n": 1, "ts": _ts}
        # EMA mean
        new_mean = old_mean + alpha * (new_val - old_mean)
        # EMA variance (exponentially-weighted moving variance)
        # Standard EWMA variance: Var_new = (1-α) * Var_old + α * (x - μ_old)²
        diff = new_val - old_mean
        new_var = (1.0 - alpha) * old_var + alpha * diff * diff
        return {
            "mean": round(new_mean, 3),
            "var": round(max(0.0, new_var), 3),
            "n": n,
            "ts": _ts,
        }

    # ── Observation recording ────────────────────────────────────────────────

    def observe(
        self,
        room: str,
        floor_id: str | None,
        ema_rssi: dict[str, float],
        source_to_area: dict[str, str],
        source_to_floor: dict[str, str],
    ) -> None:
        """Record one high-confidence observation for adaptive learning.

        Fingerprints store per-device NORMALIZED RSSI: each scanner reading
        relative to the device's mean across all scanners in this observation.
        This makes fingerprints comparable across devices with different TX
        power, which keeps per-pair variance low (and low variance is what
        makes score_rooms discriminating).
        """
        if not room or not ema_rssi or len(ema_rssi) < _MIN_OBS_SCANNERS:
            return

        fps = self.data.setdefault("room_fingerprints", {})
        room_fp = fps.setdefault(room, {})

        _dev_mean = sum(ema_rssi.values()) / len(ema_rssi)
        for src, rssi in ema_rssi.items():
            existing = room_fp.get(src, {})
            room_fp[src] = self._welford_update(existing, rssi - _dev_mean)

        # Cross-floor attenuation: record RSSI delta between same-floor and
        # cross-floor scanners.  We compare each scanner's RSSI to the
        # room's "home" scanners (those on the same floor as the room).
        if floor_id:
            fp_data = self.data.setdefault("floor_pairs", {})
            home_rssi_vals = []
            cross_entries: list[tuple[str, float]] = []
            for src, rssi in ema_rssi.items():
                src_floor = source_to_floor.get(src, "")
                if src_floor == floor_id:
                    home_rssi_vals.append(rssi)
                elif src_floor:
                    cross_entries.append((src_floor, rssi))

            if home_rssi_vals and cross_entries:
                home_mean = sum(home_rssi_vals) / len(home_rssi_vals)
                for cross_floor, cross_rssi in cross_entries:
                    pair_key = f"{floor_id}|{cross_floor}"
                    delta = cross_rssi - home_mean  # negative = weaker cross-floor
                    existing = fp_data.get(pair_key, {})
                    fp_data[pair_key] = self._welford_update(existing, delta)

        stats = self.data.setdefault("stats", {})
        stats["total_observations"] = stats.get("total_observations", 0) + 1
        if not stats.get("learning_since"):
            stats["learning_since"] = _now_iso()

    def record_transition(self, from_room: str | None, to_room: str) -> None:
        """Increment transition counter for room changes."""
        if not from_room or not to_room or from_room == to_room:
            return
        tc = self.data.setdefault("transition_counts", {})
        from_map = tc.setdefault(from_room, {})
        from_map[to_room] = from_map.get(to_room, 0) + 1

    def record_floor_transition(
        self, from_floor: str, to_floor: str, dwell_s: float
    ) -> None:
        """Record a floor-to-floor transition with dwell time before the switch."""
        if not from_floor or not to_floor or from_floor == to_floor:
            return
        ft = self.data.setdefault("floor_transitions", {})
        pair_key = f"{from_floor}|{to_floor}"
        existing = ft.get(pair_key, {})
        ft[pair_key] = self._welford_update(existing, dwell_s)

    def floor_transition_prior(
        self, from_floor: str, candidate_floors: Any
    ) -> dict[str, float]:
        """Return normalized transition probability per destination floor."""
        ft = self.data.get("floor_transitions", {})
        counts: dict[str, int] = {}
        total = 0
        for fl in candidate_floors:
            pair_key = f"{from_floor}|{fl}"
            n = ft.get(pair_key, {}).get("n", 0)
            counts[fl] = n
            total += n
        if total < 10:
            return {}
        return {fl: n / total for fl, n in counts.items()}

    def learned_floor_attenuation(self, from_floor: str, cross_floor: str) -> float | None:
        """Return mean RSSI delta for cross-floor signals, or None if insufficient data.

        The delta is typically negative (cross-floor scanners read weaker).
        """
        fp_data = self.data.get("floor_pairs", {})
        pair_key = f"{from_floor}|{cross_floor}"
        entry = fp_data.get(pair_key, {})
        if entry.get("n", 0) < _MIN_PAIR_OBS:
            return None
        return entry.get("mean")

    async def async_save_periodic(self) -> None:
        """Called periodically (not every poll) to persist to disk."""
        await self._save()

    # ── Scoring ──────────────────────────────────────────────────────────────

    def score_rooms(
        self, ema_rssi: dict[str, float], source_to_area: dict[str, str]
    ) -> dict[str, float]:
        """
        Score candidate rooms by fingerprint similarity.

        For each room with learned fingerprints, compute a Mahalanobis-like
        distance between the current per-scanner RSSI and the learned profile,
        then convert to a Gaussian score.

        The query vector is normalized per-device (relative to its mean across
        scanners) to match how observe() stores fingerprints.
        """
        fps = self.data.get("room_fingerprints", {})
        if not fps or not ema_rssi or len(ema_rssi) < _MIN_OBS_SCANNERS:
            return {}

        _dev_mean = sum(ema_rssi.values()) / len(ema_rssi)
        _norm = {src: rssi - _dev_mean for src, rssi in ema_rssi.items()}

        scores: dict[str, float] = {}
        _now_ts = time.time()
        _MAX_PAIR_AGE_S = 30 * 86400  # ignore pairs not refreshed in 30 days
        for room, room_fp in fps.items():
            shared = set(_norm.keys()) & set(room_fp.keys())
            # Only score if we have enough shared scanners with sufficient
            # data — with normalized vectors a single shared scanner is
            # uninformative (relative values need >= 2 points of reference).
            # Lifetime n alone is not enough: the environment changes, so a
            # pair must also have been refreshed recently (ts written by
            # _welford_update; pairs without one are treated as fresh).
            usable = [
                s for s in shared
                if room_fp[s].get("n", 0) >= _MIN_PAIR_OBS
                and (_now_ts - room_fp[s].get("ts", _now_ts)) < _MAX_PAIR_AGE_S
            ]
            if len(usable) < 2:
                continue

            # Gate: skip rooms where fingerprint variance is too high to be
            # useful.  High variance means the fingerprint can't distinguish
            # this room — scoring it adds noise that hurts positioning.
            avg_var = sum(room_fp[s].get("var", 0) for s in usable) / len(usable)
            if avg_var > _MAX_USEFUL_VARIANCE:
                continue

            # Mahalanobis-like distance: sum of (obs - mean)^2 / var
            dist_sq = 0.0
            for src in usable:
                fp = room_fp[src]
                diff = _norm[src] - fp["mean"]
                # Floor at 9.0 dBm² (3 dBm std): BLE RSSI at a fixed spot
                # genuinely spreads that much, and a tighter learned variance
                # is an artifact of the novelty-gated sampling, not physics —
                # a 1.0 floor made small diffs look like strong evidence.
                var = max(fp.get("var", 9.0), 9.0)
                dist_sq += (diff ** 2) / var

            avg_dist = dist_sq / len(usable)
            # Convert to 0–1 score: exp(-d/2) gives Gaussian-like falloff
            scores[room] = math.exp(-avg_dist / 2.0)

        return scores

    def transition_prior(
        self, from_room: str, candidates: Any
    ) -> dict[str, float]:
        """
        Return Bayesian prior weights for candidate rooms based on transition
        frequency from the current room.  Returns 0–1 normalized weights.
        """
        tc = self.data.get("transition_counts", {})
        from_map = tc.get(from_room, {})
        total = sum(from_map.values())
        if total < _MIN_TRANSITIONS:
            return {}

        priors: dict[str, float] = {}
        for room in candidates:
            count = from_map.get(room, 0)
            priors[room] = count / total
        return priors

    def floor_confidence(
        self,
        ema_rssi: dict[str, float],
        candidate_floor: str,
        source_to_floor: dict[str, str],
    ) -> float:
        """
        Estimate confidence that a device is actually on candidate_floor
        based on learned cross-floor attenuation.

        Returns 0–1.  High = strong evidence for candidate floor.
        """
        fp_data = self.data.get("floor_pairs", {})
        if not fp_data or not ema_rssi:
            return 0.5  # no data — neutral

        # Group scanners by floor
        floor_rssi: dict[str, list[float]] = {}
        for src, rssi in ema_rssi.items():
            fl = source_to_floor.get(src, "")
            if fl:
                floor_rssi.setdefault(fl, []).append(rssi)

        if candidate_floor not in floor_rssi:
            return 0.3  # no scanners on candidate floor — low confidence

        cand_mean = sum(floor_rssi[candidate_floor]) / len(floor_rssi[candidate_floor])

        # Compare with other floors: if candidate floor's mean RSSI is
        # significantly stronger, device is likely on that floor.
        other_means = []
        for fl, vals in floor_rssi.items():
            if fl != candidate_floor and len(vals) >= 1:
                other_means.append(sum(vals) / len(vals))

        if not other_means:
            return 0.7  # only candidate floor has scanners — moderate confidence

        best_other = max(other_means)
        gap = cand_mean - best_other  # positive = candidate floor is stronger

        # Consult learned cross-floor attenuation to set expectations.
        # If we've learned that cross-floor signals are typically 15 dBm weaker,
        # a 3 dBm gap should give LOW confidence (not 50%).
        # The sigmoid midpoint shifts to the expected delta.
        expected_delta = 5.0  # default: 5 dBm gap = 50% confidence
        for fl in floor_rssi:
            if fl == candidate_floor:
                continue
            pair_key1 = f"{candidate_floor}|{fl}"
            pair_key2 = f"{fl}|{candidate_floor}"
            learned = fp_data.get(pair_key1) or fp_data.get(pair_key2)
            if learned and learned.get("n", 0) >= 5:
                # Learned delta is typically negative (cross-floor is weaker).
                # Use its absolute value as expected gap.
                expected_delta = max(3.0, abs(learned.get("mean", 5.0)))
                break

        # Sigmoid: gap at expected_delta → ~73% confidence.
        # Gap at 0 → 50%. Gap at -expected_delta → ~27%.
        confidence = 1.0 / (1.0 + math.exp(-gap / max(2.0, expected_delta * 0.6)))
        return round(min(1.0, max(0.0, confidence)), 3)

    # ── Maturity ─────────────────────────────────────────────────────────────

    def maturity(self) -> float:
        """0–1 indicating how much learned data is available."""
        total = self.data.get("stats", {}).get("total_observations", 0)
        return round(min(1.0, total / _MATURITY_OBS), 3)

    # ── Summary / UI ─────────────────────────────────────────────────────────

    def summary(self) -> dict[str, Any]:
        """Return stats for UI display."""
        stats = self.data.get("stats", {})
        fps = self.data.get("room_fingerprints", {})
        tc = self.data.get("transition_counts", {})
        fp_data = self.data.get("floor_pairs", {})

        total_obs = stats.get("total_observations", 0)
        learning_since = stats.get("learning_since")

        # Compute days active
        days = 0
        if learning_since:
            try:
                start = datetime.fromisoformat(learning_since)
                days = max(0, (datetime.now(timezone.utc) - start).days)
            except Exception:
                pass

        rooms_learned = len(fps)
        scanners_learned = len({
            src for room_fp in fps.values() for src in room_fp
        })
        transitions_total = sum(
            sum(dest.values()) for dest in tc.values()
        )
        floor_pairs_learned = len(fp_data)

        return {
            "total_observations": total_obs,
            "learning_since": learning_since,
            "days_active": days,
            "maturity_pct": round(self.maturity() * 100, 1),
            "rooms_learned": rooms_learned,
            "scanners_learned": scanners_learned,
            "transitions_total": transitions_total,
            "floor_pairs_learned": floor_pairs_learned,
        }

    # ── Reset ────────────────────────────────────────────────────────────────

    async def async_remove_scanner(self, source: str) -> int:
        """Remove a scanner's fingerprints from all rooms.

        Returns the number of room-scanner pairs removed.
        """
        removed = 0
        fps = self.data.get("room_fingerprints", {})
        for room_fp in fps.values():
            if source in room_fp:
                del room_fp[source]
                removed += 1
        if removed:
            await self._save()
        return removed

    async def async_reset(self) -> None:
        """Clear all learned data."""
        self.data = _empty_data()
        await self._save()
        _LOGGER.info("Adaptive learning data reset")
