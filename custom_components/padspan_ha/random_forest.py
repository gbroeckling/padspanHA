# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""
Pure-Python Random Forest for BLE fingerprint positioning.

No external dependencies (no scikit-learn, no numpy).  Designed for small
calibration datasets (dozens to low hundreds of points) with ~3-14 RSSI
features.  Two separate forests: one for x_frac regression, one for y_frac
regression.  Room is determined by majority vote of the training-point rooms
in the leaf nodes.

Feature vector: one dimension per unique scanner source across all training
points.  Missing RSSI values are filled with MISSING_RSSI (-100 dBm).
"""
from __future__ import annotations

import math
import random
from typing import Any

MISSING_RSSI: float = -100.0   # fill value for scanners not heard


# ── CART Decision Tree (regression) ──────────────────────────────────────────

class _Node:
    """Binary tree node — either a split or a leaf."""
    __slots__ = ("feature", "threshold", "left", "right", "value", "indices")

    def __init__(self) -> None:
        self.feature: int = -1
        self.threshold: float = 0.0
        self.left: _Node | None = None
        self.right: _Node | None = None
        self.value: float = 0.0       # leaf prediction (mean of targets)
        self.indices: list[int] = []  # training indices that landed here


class _DecisionTree:
    """Minimal CART regression tree with feature/sample bagging."""

    def __init__(
        self,
        max_depth: int = 8,
        min_leaf: int = 2,
        max_features: float = 0.7,     # fraction of features to consider
        sample_frac: float = 0.8,      # bootstrap sample fraction
        rng: random.Random | None = None,
    ) -> None:
        self.max_depth = max_depth
        self.min_leaf = min_leaf
        self.max_features = max_features
        self.sample_frac = sample_frac
        self._rng = rng or random.Random()
        self.root: _Node | None = None
        self.n_features: int = 0
        # Maps bootstrap-sample positions back to original training indices.
        # node.indices are positions within the bootstrap sample; callers must
        # translate them via sample_idx before dereferencing training points.
        self.sample_idx: list[int] = []

    def fit(self, X: list[list[float]], y: list[float]) -> None:
        n = len(X)
        self.n_features = len(X[0]) if X else 0
        # Bootstrap sample
        k = max(1, int(n * self.sample_frac))
        sample_idx = [self._rng.randrange(n) for _ in range(k)]
        self.sample_idx = sample_idx
        Xs = [X[i] for i in sample_idx]
        ys = [y[i] for i in sample_idx]
        all_idx = list(range(len(Xs)))
        self.root = self._build(Xs, ys, all_idx, depth=0)

    def _build(
        self,
        X: list[list[float]],
        y: list[float],
        indices: list[int],
        depth: int,
    ) -> _Node:
        node = _Node()
        node.indices = indices
        vals = [y[i] for i in indices]
        node.value = sum(vals) / len(vals) if vals else 0.0

        # Stop conditions
        if depth >= self.max_depth or len(indices) < 2 * self.min_leaf:
            return node

        # Variance of current set
        mean = node.value
        var = sum((v - mean) ** 2 for v in vals)
        if var < 1e-10:
            return node  # pure node

        # Feature subset
        n_feat = max(1, int(self.n_features * self.max_features))
        feat_candidates = self._rng.sample(range(self.n_features), min(n_feat, self.n_features))

        best_gain = 0.0
        best_feat = -1
        best_thresh = 0.0
        best_left: list[int] = []
        best_right: list[int] = []

        for f in feat_candidates:
            # Collect unique values for this feature, ignoring MISSING_RSSI
            real_vals = [X[i][f] for i in indices if X[i][f] > MISSING_RSSI + 1]
            if len(real_vals) < self.min_leaf:
                continue  # too few real readings — skip this scanner
            fvals = sorted(set(X[i][f] for i in indices))
            if len(fvals) < 2:
                continue
            # Try midpoints between sorted unique values
            for vi in range(len(fvals) - 1):
                # Skip thresholds near MISSING_RSSI — splits "heard vs not heard"
                # are uninformative and cause clumping
                if fvals[vi] <= MISSING_RSSI + 1:
                    continue
                thresh = (fvals[vi] + fvals[vi + 1]) / 2.0
                left_idx = [i for i in indices if X[i][f] <= thresh]
                right_idx = [i for i in indices if X[i][f] > thresh]
                if len(left_idx) < self.min_leaf or len(right_idx) < self.min_leaf:
                    continue
                # Variance reduction
                lvals = [y[i] for i in left_idx]
                rvals = [y[i] for i in right_idx]
                lmean = sum(lvals) / len(lvals)
                rmean = sum(rvals) / len(rvals)
                lvar = sum((v - lmean) ** 2 for v in lvals)
                rvar = sum((v - rmean) ** 2 for v in rvals)
                gain = var - lvar - rvar
                if gain > best_gain:
                    best_gain = gain
                    best_feat = f
                    best_thresh = thresh
                    best_left = left_idx
                    best_right = right_idx

        if best_feat < 0:
            return node  # no valid split

        node.feature = best_feat
        node.threshold = best_thresh
        node.left = self._build(X, y, best_left, depth + 1)
        node.right = self._build(X, y, best_right, depth + 1)
        return node

    def predict(self, x: list[float]) -> float:
        node = self.root
        while node and node.feature >= 0:
            if x[node.feature] <= node.threshold:
                node = node.left
            else:
                node = node.right
        return node.value if node else 0.0

    def predict_leaf(self, x: list[float]) -> _Node:
        """Return the leaf node for inspection (indices, value)."""
        node = self.root
        while node and node.feature >= 0:
            if x[node.feature] <= node.threshold:
                node = node.left
            else:
                node = node.right
        return node


# ── Random Forest Locator ────────────────────────────────────────────────────

class RandomForestLocator:
    """
    Random Forest positioning using calibration fingerprint data.

    Returns the same dict shape as CalibrationStore.knn_locate() so the
    presence coordinator can use either algorithm interchangeably.
    """

    def __init__(
        self,
        n_trees: int = 30,
        max_depth: int = 8,
        min_leaf: int = 2,
        seed: int = 42,
    ) -> None:
        self.n_trees = n_trees
        self.max_depth = max_depth
        self.min_leaf = min_leaf
        self._seed = seed
        self._x_trees: list[_DecisionTree] = []
        self._y_trees: list[_DecisionTree] = []
        self._sources: list[str] = []     # ordered scanner source names
        self._points: list[dict] = []     # training points (for room lookup)
        self._trained = False
        self._use_metres = False          # Phase 3: True when trained on x_m/y_m

    @property
    def is_trained(self) -> bool:
        return self._trained

    def train(
        self,
        points: list[dict[str, Any]],
        excluded: frozenset[str] | set[str] | None = None,
    ) -> None:
        """
        Build forest from calibration points, in metres.
        Each point: {x_m, y_m, room, floor_id, scanner_readings: [{source, mean_rssi}]}

        Metres only. The forest used to fall back to training on x_frac/y_frac
        — a photo's coordinate space — which meant the model literally learned
        where things were on a picture. A point with no real-world position is
        still a perfectly good RSSI fingerprint for room-level presence; it is
        just not something to regress a position from.

        `excluded` (issue #59) drops those sources from the feature index, so
        the forest has no column for them at all. Because predict() builds its
        query vector from the same index, a masked scanner is ignored on both
        sides without touching a single stored sample — retraining with an
        empty exclusion set restores the old model exactly.
        """
        self._use_metres = True
        valid = [
            p for p in points
            if p.get("scanner_readings")
            and p.get("x_m") is not None
            and p.get("y_m") is not None
        ]
        if len(valid) < 4:
            self._trained = False
            return

        self._points = valid

        # Build feature index: only use scanners that appear in ≥20% of points.
        # Rare scanners are mostly MISSING_RSSI, which dominates tree splits
        # and causes all predictions to converge to the majority room.
        src_counts: dict[str, int] = {}
        for p in valid:
            for r in p.get("scanner_readings", []):
                s = r.get("source", "")
                if s:
                    src_counts[s] = src_counts.get(s, 0) + 1
        min_appearances = max(2, int(len(valid) * 0.15))
        _excl = excluded or frozenset()
        self._sources = sorted(
            s for s, c in src_counts.items() if c >= min_appearances and s not in _excl
        )
        src_idx = {s: i for i, s in enumerate(self._sources)}
        n_feat = len(self._sources)

        if n_feat == 0:
            self._trained = False
            return

        # Build feature matrix and target vectors
        X: list[list[float]] = []
        y_x: list[float] = []
        y_y: list[float] = []

        for p in valid:
            row = [MISSING_RSSI] * n_feat
            for r in p.get("scanner_readings", []):
                s = r.get("source", "")
                if s in src_idx:
                    row[src_idx[s]] = float(r.get("mean_rssi", MISSING_RSSI))
            X.append(row)
            y_x.append(float(p["x_m"]))
            y_y.append(float(p["y_m"]))

        # Train forests for x and y
        rng = random.Random(self._seed)
        self._x_trees = []
        self._y_trees = []
        for _ in range(self.n_trees):
            tx = _DecisionTree(self.max_depth, self.min_leaf, rng=random.Random(rng.randint(0, 2**31)))
            tx.fit(X, y_x)
            self._x_trees.append(tx)

            ty = _DecisionTree(self.max_depth, self.min_leaf, rng=random.Random(rng.randint(0, 2**31)))
            ty.fit(X, y_y)
            self._y_trees.append(ty)

        self._trained = True

    def predict(
        self,
        query_rssi: dict[str, float],
        map_id: str | None = None,
    ) -> dict[str, Any] | None:
        """
        Predict position from live RSSI readings.
        Returns same shape as knn_locate():
        {x_frac, y_frac, confidence, nearest_room, map_id, k_used, shared_scanners}
        plus {x_m, y_m, floor_id} when the model was trained in metres.
        """
        if not self._trained or not query_rssi:
            return None

        # Build query feature vector
        src_idx = {s: i for i, s in enumerate(self._sources)}
        n_feat = len(self._sources)
        qvec = [MISSING_RSSI] * n_feat
        shared = 0
        for s, rssi in query_rssi.items():
            if s in src_idx:
                qvec[src_idx[s]] = float(rssi)
                shared += 1

        if shared == 0:
            return None

        # Predict x and y from each tree
        x_preds = [t.predict(qvec) for t in self._x_trees]
        y_preds = [t.predict(qvec) for t in self._y_trees]

        # Mean prediction
        x_mean = sum(x_preds) / len(x_preds)
        y_mean = sum(y_preds) / len(y_preds)

        # Determine room via leaf-node majority vote
        # Collect training points from leaf nodes across all trees.
        # node.indices are positions within each tree's bootstrap sample, so
        # they must be mapped back to original training indices through the
        # tree's sample_idx before dereferencing self._points.
        vote_pts: list[dict] = []
        for tx, ty in zip(self._x_trees, self._y_trees):
            leaf_x = tx.predict_leaf(qvec)
            leaf_y = ty.predict_leaf(qvec)
            # Combine unique original indices from both x and y leaves
            leaf_indices: set[int] = set()
            if leaf_x:
                leaf_indices.update(tx.sample_idx[i] for i in leaf_x.indices)
            if leaf_y:
                leaf_indices.update(ty.sample_idx[i] for i in leaf_y.indices)
            for idx in leaf_indices:
                if idx < len(self._points):
                    vote_pts.append(self._points[idx])

        # Dominant floor among voting points (metre space only) — mirrors
        # knn_locate's floor grouping so overlapping floors don't cross-vote.
        best_floor = ""
        if self._use_metres:
            floor_votes: dict[str, int] = {}
            for pt in vote_pts:
                fl = pt.get("floor_id", "")
                if fl:
                    floor_votes[fl] = floor_votes.get(fl, 0) + 1
            best_floor = max(floor_votes, key=lambda f: floor_votes[f]) if floor_votes else ""

        room_votes: dict[str, int] = {}
        map_votes: dict[str, int] = {}
        for pt in vote_pts:
            if best_floor and pt.get("floor_id", "") != best_floor:
                continue
            rm = pt.get("room", "")
            if rm:
                room_votes[rm] = room_votes.get(rm, 0) + 1
            mid = pt.get("map_id", "")
            if mid:
                map_votes[mid] = map_votes.get(mid, 0) + 1

        best_room = max(room_votes, key=lambda r: room_votes[r]) if room_votes else ""
        best_map = max(map_votes, key=lambda m: map_votes[m]) if map_votes else ""
        # Normalise the leaf-vote to fractions — same "why this room" breakdown
        # as knn_locate's room_scores, from the same discarded-after-argmax vote.
        _room_votes_total = sum(room_votes.values())
        room_scores = (
            {r: round(v / _room_votes_total, 3) for r, v in room_votes.items()}
            if _room_votes_total > 0 else {}
        )

        # Confidence: combination of prediction variance and scanner coverage
        # Low variance across trees = high agreement = high confidence
        x_var = sum((xp - x_mean) ** 2 for xp in x_preds) / len(x_preds)
        y_var = sum((yp - y_mean) ** 2 for yp in y_preds) / len(y_preds)
        total_var = x_var + y_var
        # Map variance to confidence: var=0 → 100%, var=ref → 50%.
        # Reference variance depends on the coordinate space the model was
        # trained in (recorded at fit time): 0.01 for 0-1 map fractions,
        # 1.0 m² for metres (a tight ±0.5 m tree spread stays high-confidence,
        # a ±3 m spread collapses toward zero).
        _ref_var = 1.0 if self._use_metres else 0.01
        _conf_agreement = 1.0 / (1.0 + total_var / _ref_var)
        # Scanner coverage penalty (same as k-NN)
        _conf_coverage = min(shared, 4) / 4.0
        confidence = round(_conf_agreement * _conf_coverage, 3)

        result = {
            "confidence": confidence,
            "nearest_room": best_room,
            "room_scores": room_scores,
            "map_id": best_map,
            "k_used": self.n_trees,
            "shared_scanners": shared,
        }
        result["x_m"] = round(x_mean, 3)
        result["y_m"] = round(y_mean, 3)
        result["floor_id"] = best_floor
        return result
