"""Unit tests for presence_coordinator.py pure helpers.

Tests the Kalman filter, Gaussian room scoring, RSSI margin confidence,
majority-vote room assignment, and related smoothing logic on the
PresenceCoordinator class.
"""

from __future__ import annotations

import math
from collections import deque
from typing import Any
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha.const import (
    DEFAULT_KALMAN_Q,
    DEFAULT_KALMAN_R,
    DEFAULT_PATH_LOSS_EXP,
    DEFAULT_REF_POWER,
    DEFAULT_ROOM_SIGMA_M,
    DOMAIN,
    DATA_SETTINGS,
    DATA_CALIBRATION,
)
from custom_components.padspan_ha.presence_coordinator import (
    PresenceCoordinator,
    _VOTE_WINDOW,
    _VOTE_THRESHOLD,
    _EMA_PRUNE_DBM,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_coordinator(
    *,
    settings: dict[str, Any] | None = None,
    calibration: Any = None,
) -> PresenceCoordinator:
    """Build a PresenceCoordinator backed by mocks, ready for _smooth_room calls."""
    hass = MagicMock()

    # Wire up hass.data[DOMAIN][DATA_SETTINGS]
    mock_settings = MagicMock()
    mock_settings.data = settings or {}

    domain_data: dict[str, Any] = {DATA_SETTINGS: mock_settings}
    if calibration is not None:
        domain_data[DATA_CALIBRATION] = calibration

    hass.data = {DOMAIN: domain_data}

    # Construct via the REAL __init__ — the conftest DataUpdateCoordinator stub
    # accepts the real signature and stores hass/update_interval.  This way the
    # helper never rots when __init__ grows new attributes (the old approach
    # hand-copied ~12 of ~30 attributes and broke on every addition).
    coord = PresenceCoordinator(hass)

    # Per-poll accumulator normally created at the top of _async_update_data;
    # tests call _smooth_room directly, so seed it here.
    coord._pending_room_changes = []

    return coord


def _gaussian_score(rssi: float, ref: float, n_exp: float, sigma: float) -> float:
    """Replicate the Gaussian scoring formula for verification."""
    dist = max(0.1, 10.0 ** ((ref - rssi) / (10.0 * n_exp)))
    return math.exp(-(dist / sigma) ** 2)


# ---------------------------------------------------------------------------
# Tests: Kalman filter update logic
# ---------------------------------------------------------------------------


class TestKalmanUpdate:
    """Tests for the Kalman filter update in _smooth_room (Stage 1)."""

    def test_first_observation_seeds_without_smoothing(self) -> None:
        """First RSSI for a source should be stored as-is (no smoothing)."""
        coord = _make_coordinator()
        addr_src = {"AA:BB": {"scanner1": -60.0}}
        src_area = {"scanner1": "Living Room"}

        coord._smooth_room("dev1", "AA:BB", addr_src, src_area)

        assert coord._ema_rssi["AA:BB"]["scanner1"] == pytest.approx(-60.0)
        # Initial P should be R (maximum uncertainty)
        assert coord._kalman_p["AA:BB"]["scanner1"] == pytest.approx(DEFAULT_KALMAN_R)

    def test_second_observation_applies_kalman_gain(self) -> None:
        """After seeding, the second observation should be filtered via the Kalman gain."""
        coord = _make_coordinator()
        addr_src = {"AA:BB": {"scanner1": -60.0}}
        src_area = {"scanner1": "Living Room"}

        # Poll 1: seed
        coord._smooth_room("dev1", "AA:BB", addr_src, src_area)

        # Poll 2: new measurement
        addr_src["AA:BB"]["scanner1"] = -50.0
        coord._smooth_room("dev1", "AA:BB", addr_src, src_area)

        # After poll 1: x=-60, P=R=8.0
        # Poll 2: K = P / (P + R) = 8.0 / (8.0 + 8.0) = 0.5 (but P was updated by +Q in poll 1's prune step...)
        # Actually in poll 1, scanner1 reported, so it goes through the update path only,
        # and since there are no silent sources the decay loop is empty.
        # So after poll 1: x=-60, P=R=8.0
        # Poll 2: P from previous = (1-K_prev)*P_prev + Q... wait, the P update happens in same poll.
        # Let's verify: after seed, P[scanner1] = R = 8.0
        # Poll 2 update: p=8.0, K = 8/(8+8) = 0.5, x_new = -60 + 0.5*(-50 - (-60)) = -60 + 5 = -55
        # p_new = (1-0.5)*8 + Q = 4 + 0.125 = 4.125
        filtered = coord._ema_rssi["AA:BB"]["scanner1"]
        assert filtered == pytest.approx(-55.0)
        assert coord._kalman_p["AA:BB"]["scanner1"] == pytest.approx(4.125)

    def test_kalman_converges_to_stable_rssi(self) -> None:
        """Repeated identical measurements should converge the filter to the true value."""
        coord = _make_coordinator()
        src_area = {"scanner1": "Kitchen"}

        for _ in range(30):
            coord._smooth_room("dev1", "AA:BB", {"AA:BB": {"scanner1": -70.0}}, src_area)

        # After many iterations, should converge very close to -70
        assert coord._ema_rssi["AA:BB"]["scanner1"] == pytest.approx(-70.0, abs=0.5)

    def test_kalman_responds_to_step_change(self) -> None:
        """A sudden jump in RSSI should eventually be tracked by the filter."""
        coord = _make_coordinator()
        src_area = {"scanner1": "Room"}

        # Stabilize at -60
        for _ in range(20):
            coord._smooth_room("dev1", "AA:BB", {"AA:BB": {"scanner1": -60.0}}, src_area)

        # Jump to -80
        for _ in range(20):
            coord._smooth_room("dev1", "AA:BB", {"AA:BB": {"scanner1": -80.0}}, src_area)

        # Should have moved toward -80 after many polls.
        # The Kalman filter with low Q converges slowly; check it moved below -75.
        assert coord._ema_rssi["AA:BB"]["scanner1"] < -75.0






# ---------------------------------------------------------------------------
# Tests: Kalman filter decay (silent sources)
# ---------------------------------------------------------------------------


class TestKalmanDecay:
    """Tests for silent-source decay and pruning."""

    def test_silent_source_decays_toward_minus_100(self) -> None:
        """Past the silence grace, a silent source decays toward the silence target.

        Silence grace = ~20 s worth of polls (poll-interval-scaled): misses
        inside the grace hold the RSSI steady; only after it does decay start.
        """
        coord = _make_coordinator()
        src_area = {"scanner1": "Room"}

        # Seed at -60
        coord._smooth_room("dev1", "AA:BB", {"AA:BB": {"scanner1": -60.0}}, src_area)

        poll_s = coord.update_interval.total_seconds()
        grace_polls = max(1, round(20.0 / poll_s))

        # During the grace the value is held steady (no phantom decay from
        # a single missed advertisement).
        for _ in range(grace_polls - 1):
            coord._smooth_room("dev1", "AA:BB", {"AA:BB": {}}, src_area)
            assert coord._ema_rssi["AA:BB"]["scanner1"] == pytest.approx(-60.0)

        # Past the grace: each poll moves closer to the silence target
        coord._smooth_room("dev1", "AA:BB", {"AA:BB": {}}, src_area)
        after_one_decay = coord._ema_rssi["AA:BB"]["scanner1"]

        coord._smooth_room("dev1", "AA:BB", {"AA:BB": {}}, src_area)
        after_two_decay = coord._ema_rssi["AA:BB"]["scanner1"]

        assert after_one_decay < -60.0
        assert after_two_decay < after_one_decay

    def test_silent_source_eventually_pruned(self) -> None:
        """A fully-silent source is pruned by the hard miss-count cap.

        Under TOTAL silence the decay target is -95 dBm, which sits ABOVE the
        -98 prune threshold — decay alone can never prune the entry.  The
        hard cap (~300 s worth of missed polls) is what removes it.
        """
        coord = _make_coordinator()
        src_area = {"scanner1": "Room"}

        # Seed at -60
        coord._smooth_room("dev1", "AA:BB", {"AA:BB": {"scanner1": -60.0}}, src_area)

        poll_s = coord.update_interval.total_seconds()
        cap_polls = max(6, round(300.0 / poll_s))

        # One poll before the cap the entry still exists (asymptotically
        # approaching -95, never crossing the -98 prune threshold).
        for _ in range(cap_polls - 1):
            coord._smooth_room("dev1", "AA:BB", {"AA:BB": {}}, src_area)
        assert "scanner1" in coord._ema_rssi.get("AA:BB", {})
        assert coord._ema_rssi["AA:BB"]["scanner1"] > _EMA_PRUNE_DBM

        # The poll that reaches the cap prunes the Kalman state entirely.
        coord._smooth_room("dev1", "AA:BB", {"AA:BB": {}}, src_area)
        assert "scanner1" not in coord._ema_rssi.get("AA:BB", {})

    def test_active_sources_not_decayed(self) -> None:
        """Sources that keep reporting should not be decayed."""
        coord = _make_coordinator()
        src_area = {"scanner1": "Room", "scanner2": "Room2"}

        # Seed both
        coord._smooth_room("dev1", "AA:BB", {"AA:BB": {"scanner1": -55.0, "scanner2": -65.0}}, src_area)

        # Only scanner1 reports in subsequent polls
        for _ in range(5):
            coord._smooth_room("dev1", "AA:BB", {"AA:BB": {"scanner1": -55.0}}, src_area)

        # scanner1 should still be near -55, scanner2 should have decayed
        assert coord._ema_rssi["AA:BB"]["scanner1"] == pytest.approx(-55.0, abs=1.0)
        assert coord._ema_rssi["AA:BB"].get("scanner2", -100) < -65.0


# ---------------------------------------------------------------------------
# Tests: RSSI margin confidence
# ---------------------------------------------------------------------------


class TestRssiMarginConfidence:
    """Tests for the RSSI margin confidence metric."""

    def test_single_scanner_gives_full_confidence(self) -> None:
        """With only one scanner, margin confidence should be 1.0."""
        coord = _make_coordinator()
        src_area = {"scanner1": "Room"}

        coord._smooth_room("dev1", "AA:BB", {"AA:BB": {"scanner1": -60.0}}, src_area)

        assert coord._rssi_margin_confidence["dev1"] == 1.0

    def test_large_gap_gives_high_confidence(self) -> None:
        """A 15+ dBm gap between scanners should give confidence close to 1.0."""
        coord = _make_coordinator()
        src_area = {"scanner1": "Room1", "scanner2": "Room2"}

        coord._smooth_room(
            "dev1", "AA:BB",
            {"AA:BB": {"scanner1": -50.0, "scanner2": -70.0}},
            src_area,
        )

        # Gap = 20 dBm, confidence = min(1.0, 20/15) = 1.0
        assert coord._rssi_margin_confidence["dev1"] == pytest.approx(1.0)

    def test_small_gap_gives_low_confidence(self) -> None:
        """A small dBm gap should give proportionally low confidence."""
        coord = _make_coordinator()
        src_area = {"scanner1": "Room1", "scanner2": "Room2"}

        coord._smooth_room(
            "dev1", "AA:BB",
            {"AA:BB": {"scanner1": -60.0, "scanner2": -63.0}},
            src_area,
        )

        # Gap = 3 dBm, confidence = 3/15 = 0.2
        assert coord._rssi_margin_confidence["dev1"] == pytest.approx(0.2)

    def test_zero_gap_gives_zero_confidence(self) -> None:
        """Equal RSSI values should give 0.0 confidence."""
        coord = _make_coordinator()
        src_area = {"scanner1": "Room1", "scanner2": "Room2"}

        coord._smooth_room(
            "dev1", "AA:BB",
            {"AA:BB": {"scanner1": -60.0, "scanner2": -60.0}},
            src_area,
        )

        assert coord._rssi_margin_confidence["dev1"] == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# Tests: Gaussian room scoring
# ---------------------------------------------------------------------------


class TestGaussianRoomScoring:
    """Tests for the Gaussian distance scoring and room assignment."""

    def test_closest_scanner_wins(self) -> None:
        """The room with the strongest RSSI (closest scanner) should be selected."""
        coord = _make_coordinator()
        src_area = {"scanner_lr": "Living Room", "scanner_kit": "Kitchen"}

        # Need many polls for Kalman to converge + majority vote to confirm
        for _ in range(max(_VOTE_THRESHOLD, 15)):
            result = coord._smooth_room(
                "dev1", "AA:BB",
                {"AA:BB": {"scanner_lr": -45.0, "scanner_kit": -75.0}},
                src_area,
            )

        assert result == "Living Room"

    def test_gaussian_scores_consistent_with_formula(self) -> None:
        """The Gaussian scoring should match the expected math formula."""
        # Verify the helper function matches what the coordinator would compute
        ref = DEFAULT_REF_POWER   # -59
        n_exp = DEFAULT_PATH_LOSS_EXP  # 2.5
        sigma = DEFAULT_ROOM_SIGMA_M   # 4.0

        # At RSSI = ref (-59), distance = 1m, score = exp(-(1/4)^2) = exp(-0.0625) ~ 0.9394
        score_at_1m = _gaussian_score(-59.0, ref, n_exp, sigma)
        assert score_at_1m == pytest.approx(math.exp(-0.0625), abs=0.001)

        # At much weaker RSSI, score should be much lower
        score_far = _gaussian_score(-90.0, ref, n_exp, sigma)
        assert score_far < score_at_1m
        assert score_far < 0.1  # very low for far-away scanner

    def test_hysteresis_prevents_flipping(self) -> None:
        """When two rooms are close in score, hysteresis should prevent flipping."""
        coord = _make_coordinator()
        src_area = {"scanner_a": "RoomA", "scanner_b": "RoomB"}

        # First establish RoomA as confirmed with a clear signal
        for _ in range(_VOTE_WINDOW + 1):
            coord._smooth_room(
                "dev1", "AA:BB",
                {"AA:BB": {"scanner_a": -50.0, "scanner_b": -80.0}},
                src_area,
            )
        assert coord._confirmed_room.get("dev1") == "RoomA"

        # Now make RoomB just barely stronger -- hysteresis should keep RoomA
        # The hysteresis margin is 0.12; with very close Gaussian scores, the
        # current room should be kept.
        coord._smooth_room(
            "dev1", "AA:BB",
            {"AA:BB": {"scanner_a": -55.0, "scanner_b": -54.0}},
            src_area,
        )

        # The candidate from this single poll may be RoomA or RoomB depending on
        # hysteresis, but the confirmed room should still be RoomA because
        # the vote window needs threshold crosses.
        assert coord._confirmed_room.get("dev1") == "RoomA"

    def test_no_scanners_mapped_to_rooms_returns_none(self) -> None:
        """When no scanners have room assignments, no candidate is produced."""
        coord = _make_coordinator()
        src_area = {}  # no scanner-to-area mapping

        result = coord._smooth_room(
            "dev1", "AA:BB",
            {"AA:BB": {"scanner1": -50.0}},
            src_area,
        )

        # With no room scoring possible, result should be None
        assert result is None


# ---------------------------------------------------------------------------
# Tests: Majority vote room assignment
# ---------------------------------------------------------------------------


class TestMajorityVote:
    """Tests for the majority-vote window logic (Stage 2)."""

    def test_vote_threshold_required_for_confirmation(self) -> None:
        """Room is not confirmed until VOTE_THRESHOLD polls agree."""
        coord = _make_coordinator()
        src_area = {"scanner_lr": "Living Room"}

        # First poll: only 1 vote
        result = coord._smooth_room(
            "dev1", "AA:BB",
            {"AA:BB": {"scanner_lr": -55.0}},
            src_area,
        )

        # With default VOTE_THRESHOLD=3, one poll should not be enough
        # to confirm (unless it's the first time and threshold is 1)
        # Actually: confirmed starts None; 1 out of 1 vote, threshold=3 -> not confirmed
        # But let's check -- after 1 poll, counts={"Living Room": 1}, len(votes)=1,
        # top_count=1 < threshold=3, so confirmed stays None
        assert coord._confirmed_room.get("dev1") is None

    def test_consistent_votes_confirm_room(self) -> None:
        """Enough consistent votes should confirm the room."""
        coord = _make_coordinator()
        src_area = {"scanner_lr": "Living Room"}

        for _ in range(_VOTE_THRESHOLD):
            coord._smooth_room(
                "dev1", "AA:BB",
                {"AA:BB": {"scanner_lr": -55.0}},
                src_area,
            )

        assert coord._confirmed_room.get("dev1") == "Living Room"

    def test_room_change_requires_threshold_votes(self) -> None:
        """Changing rooms requires the new room to win enough votes."""
        coord = _make_coordinator()
        src_area = {"scanner_lr": "Living Room", "scanner_kit": "Kitchen"}

        # Establish Living Room with strong signal and many polls to stabilize Kalman
        for _ in range(15):
            coord._smooth_room(
                "dev1", "AA:BB",
                {"AA:BB": {"scanner_lr": -40.0, "scanner_kit": -90.0}},
                src_area,
            )
        assert coord._confirmed_room.get("dev1") == "Living Room"

        # One Kitchen poll shouldn't change the confirmed room
        coord._smooth_room(
            "dev1", "AA:BB",
            {"AA:BB": {"scanner_lr": -90.0, "scanner_kit": -40.0}},
            src_area,
        )
        assert coord._confirmed_room.get("dev1") == "Living Room"

        # Many polls with Kitchen dominant — need enough for Kalman to settle
        # past the hysteresis margin and accumulate threshold votes.
        # Kalman is slow to converge, so we need ~40+ polls.
        for _ in range(50):
            coord._smooth_room(
                "dev1", "AA:BB",
                {"AA:BB": {"scanner_lr": -95.0, "scanner_kit": -40.0}},
                src_area,
            )
        assert coord._confirmed_room.get("dev1") == "Kitchen"

    def test_vote_confidence_reflects_unanimity(self) -> None:
        """Confidence should be 1.0 when all votes agree."""
        coord = _make_coordinator()
        src_area = {"scanner1": "Room"}

        for _ in range(_VOTE_WINDOW):
            coord._smooth_room(
                "dev1", "AA:BB",
                # Two live scanners: the smallest vector k-NN will consider.
                # One reading has no discriminating power against a fingerprint
                # database and is no longer put to it (see _KNN_MIN_LIVE_SCANNERS).
                {"AA:BB": {"scanner1": -55.0, "scanner2": -70.0}},
                src_area,
            )

        assert coord._room_confidence["dev1"] == pytest.approx(1.0)

    def test_custom_vote_window_and_threshold(self) -> None:
        """Custom vote_window/threshold should override the defaults."""
        coord = _make_coordinator()
        src_area = {"scanner1": "Room"}

        # Use a very small window (1 poll = immediate confirmation)
        result = coord._smooth_room(
            "dev1", "AA:BB",
            {"AA:BB": {"scanner1": -55.0}},
            src_area,
            vote_window=1,
            vote_threshold=1,
        )

        assert result == "Room"
        assert coord._confirmed_room["dev1"] == "Room"

    def test_vote_window_resizes_preserving_history(self) -> None:
        """Changing vote_window mid-stream should preserve recent votes."""
        coord = _make_coordinator()
        src_area = {"scanner1": "Room"}

        # Fill 5-entry window
        for _ in range(5):
            coord._smooth_room(
                "dev1", "AA:BB",
                # Two live scanners: the smallest vector k-NN will consider.
                # One reading has no discriminating power against a fingerprint
                # database and is no longer put to it (see _KNN_MIN_LIVE_SCANNERS).
                {"AA:BB": {"scanner1": -55.0, "scanner2": -70.0}},
                src_area,
                vote_window=5,
                vote_threshold=3,
            )
        assert len(coord._room_votes["dev1"]) == 5

        # Resize down to 3; should keep last 3 votes
        coord._smooth_room(
            "dev1", "AA:BB",
            {"AA:BB": {"scanner1": -55.0}},
            src_area,
            vote_window=3,
            vote_threshold=2,
        )
        assert coord._room_votes["dev1"].maxlen == 3
        assert len(coord._room_votes["dev1"]) == 3


# ---------------------------------------------------------------------------
# Tests: Edge cases
# ---------------------------------------------------------------------------


class TestEdgeCases:
    """Edge cases and boundary conditions."""

    def test_no_data_for_address(self) -> None:
        """When the address has no data in addr_src_rssi, nothing crashes."""
        coord = _make_coordinator()
        src_area = {"scanner1": "Room"}

        result = coord._smooth_room("dev1", "UNKNOWN", {}, src_area)

        # No data => no ema => no candidate => confirmed stays None
        assert result is None

    def test_empty_source_to_area(self) -> None:
        """When source_to_area is empty, RSSI is tracked but no room is scored."""
        coord = _make_coordinator()

        result = coord._smooth_room(
            "dev1", "AA:BB",
            {"AA:BB": {"scanner1": -60.0}},
            {},  # empty mapping
        )

        # Kalman state should still be populated
        assert "scanner1" in coord._ema_rssi["AA:BB"]
        # But no room candidate
        assert result is None

    def test_multiple_devices_independent(self) -> None:
        """Smoothing state for different device keys is independent."""
        coord = _make_coordinator()
        src_area = {"scanner1": "RoomA", "scanner2": "RoomB"}

        for _ in range(_VOTE_THRESHOLD):
            coord._smooth_room(
                "dev1", "AA:11",
                {"AA:11": {"scanner1": -50.0, "scanner2": -80.0}},
                src_area,
            )
            coord._smooth_room(
                "dev2", "AA:22",
                {"AA:22": {"scanner1": -80.0, "scanner2": -50.0}},
                src_area,
            )

        assert coord._confirmed_room.get("dev1") == "RoomA"
        assert coord._confirmed_room.get("dev2") == "RoomB"

    def test_multiple_scanners_same_room_takes_max_score(self) -> None:
        """Multiple scanners assigned to the same room should use the max score."""
        coord = _make_coordinator()
        src_area = {"scanner1": "Room", "scanner2": "Room"}

        for _ in range(_VOTE_THRESHOLD):
            coord._smooth_room(
                "dev1", "AA:BB",
                {"AA:BB": {"scanner1": -50.0, "scanner2": -70.0}},
                src_area,
            )

        # Room should be confirmed using the stronger scanner's score
        assert coord._confirmed_room.get("dev1") == "Room"

    def test_knn_override_when_calibration_present(self) -> None:
        """k-NN override should replace the Gaussian candidate when calibration data is available."""
        # Create a mock calibration store with enough points and confident knn_locate
        mock_calib = MagicMock()
        mock_calib.data = {"points": [{"x": i} for i in range(10)]}  # 10 points > _KNN_MIN_POINTS
        mock_calib.knn_locate = MagicMock(return_value={
            "confidence": 0.8,
            "nearest_room": "CalibratedRoom",
            "x_frac": 0.5,
            "y_frac": 0.3,
        })

        coord = _make_coordinator(calibration=mock_calib)
        # The k-NN room must be a REAL room to be accepted (pseudo-room
        # guard) — give it a centroid, as the fabric would.
        coord._room_centroids = {"CalibratedRoom": (1.0, 1.0, "main")}
        src_area = {"scanner1": "GaussianRoom"}

        for _ in range(_VOTE_THRESHOLD):
            coord._smooth_room(
                "dev1", "AA:BB",
                # Two live scanners: the smallest vector k-NN will consider.
                # One reading has no discriminating power against a fingerprint
                # database and is no longer put to it (see _KNN_MIN_LIVE_SCANNERS).
                {"AA:BB": {"scanner1": -55.0, "scanner2": -70.0}},
                src_area,
            )

        # k-NN should have overridden to CalibratedRoom
        assert coord._confirmed_room.get("dev1") == "CalibratedRoom"

    def test_knn_pseudo_room_is_rejected(self) -> None:
        """A k-NN room that is not a real room (device-label sample) must not confirm."""
        mock_calib = MagicMock()
        mock_calib.data = {"points": [{"x": i} for i in range(10)]}
        mock_calib.knn_locate = MagicMock(return_value={
            "confidence": 0.8,
            "nearest_room": "Nicoles---Purse",   # device label, not a room
            "x_m": 4.2,
            "y_m": 3.1,
            "floor_id": "main",
        })

        coord = _make_coordinator(calibration=mock_calib)
        src_area = {"scanner1": "GaussianRoom"}

        for _ in range(_VOTE_THRESHOLD):
            coord._smooth_room(
                "dev1", "AA:BB",
                # Two live scanners: the smallest vector k-NN will consider.
                # One reading has no discriminating power against a fingerprint
                # database and is no longer put to it (see _KNN_MIN_LIVE_SCANNERS).
                {"AA:BB": {"scanner1": -55.0, "scanner2": -70.0}},
                src_area,
            )

        # The phantom room is refused; the Gaussian result stands.
        assert coord._confirmed_room.get("dev1") == "GaussianRoom"
        assert coord._knn_position.get("dev1") is not None
        # Positions are metres — a photo fraction is not a position.
        assert coord._knn_position["dev1"]["x_m"] == pytest.approx(4.2)
        assert "x_frac" not in coord._knn_position["dev1"]

    def test_knn_ignored_when_low_confidence(self) -> None:
        """k-NN should be ignored when its confidence is below the threshold."""
        mock_calib = MagicMock()
        mock_calib.data = {"points": [{"x": i} for i in range(10)]}
        mock_calib.knn_locate = MagicMock(return_value={
            "confidence": 0.1,  # below _KNN_LIVE_THRESHOLD (0.30)
            "nearest_room": "CalibratedRoom",
        })

        coord = _make_coordinator(calibration=mock_calib)
        src_area = {"scanner1": "GaussianRoom"}

        for _ in range(_VOTE_THRESHOLD):
            coord._smooth_room(
                "dev1", "AA:BB",
                # Two live scanners: the smallest vector k-NN will consider.
                # One reading has no discriminating power against a fingerprint
                # database and is no longer put to it (see _KNN_MIN_LIVE_SCANNERS).
                {"AA:BB": {"scanner1": -55.0, "scanner2": -70.0}},
                src_area,
            )

        # Gaussian candidate should win (not the k-NN one)
        assert coord._confirmed_room.get("dev1") == "GaussianRoom"
        assert coord._knn_position.get("dev1") is None

    def test_pending_room_changes_tracked(self) -> None:
        """Room transitions should be recorded in _pending_room_changes."""
        coord = _make_coordinator()
        src_area = {"scanner_a": "RoomA", "scanner_b": "RoomB"}

        # Establish RoomA with many polls to stabilize Kalman
        for _ in range(15):
            coord._smooth_room(
                "dev1", "AA:BB",
                {"AA:BB": {"scanner_a": -40.0, "scanner_b": -95.0}},
                src_area,
            )
        assert coord._confirmed_room["dev1"] == "RoomA"
        coord._pending_room_changes.clear()

        # Transition to RoomB with extreme signal difference and enough polls
        # for Kalman to settle and the vote window to fill.
        # Kalman is slow to converge so we need ~50 polls.
        for _ in range(50):
            coord._smooth_room(
                "dev1", "AA:BB",
                {"AA:BB": {"scanner_a": -95.0, "scanner_b": -40.0}},
                src_area,
            )
        assert coord._confirmed_room["dev1"] == "RoomB"

        # Should have recorded the transition
        transitions = [(k, o, n) for k, o, n in coord._pending_room_changes if k == "dev1"]
        assert len(transitions) >= 1
        assert transitions[-1] == ("dev1", "RoomA", "RoomB")
