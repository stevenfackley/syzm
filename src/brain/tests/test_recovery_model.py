"""Unit tests for the segmented recovery model."""
from __future__ import annotations

import pytest

from app.services.recovery_model import (
    DEFAULT_DECLINE_MIX,
    SEGMENT_CONFIG,
    estimate_recovery,
)


# ---------------------------------------------------------------------------
# Zero-amount edge case
# ---------------------------------------------------------------------------

def test_zero_amount_returns_zero_recoverable() -> None:
    result = estimate_recovery(breakdown=None, total_amount_cents=0)
    assert result.recoverable_amount_cents == 0
    assert result.blended_recovery_rate == 0.0
    assert result.confidence_low_cents == 0
    assert result.confidence_high_cents == 0


# ---------------------------------------------------------------------------
# Fraud-only → 0% recovery, do_not_retry=True
# ---------------------------------------------------------------------------

def test_fraud_only_breakdown_returns_zero() -> None:
    result = estimate_recovery(
        breakdown={"fraud": 100_000},
        total_amount_cents=100_000,
    )
    assert result.recoverable_amount_cents == 0
    assert result.blended_recovery_rate == 0.0
    assert len(result.segments) == 1
    assert result.segments[0].do_not_retry is True


# ---------------------------------------------------------------------------
# Transient-only → ~45% recovery
# ---------------------------------------------------------------------------

def test_transient_only_recovery_rate() -> None:
    result = estimate_recovery(
        breakdown={"transient": 100_000},
        total_amount_cents=100_000,
    )
    expected = int(100_000 * 0.45)
    assert result.recoverable_amount_cents == expected
    assert abs(result.blended_recovery_rate - 0.45) < 1e-6
    assert result.segments[0].do_not_retry is False


# ---------------------------------------------------------------------------
# Mixed breakdown
# ---------------------------------------------------------------------------

def test_mixed_breakdown_sums_correctly() -> None:
    breakdown = {
        "insufficient_funds": 50_000,   # 35% → 17500
        "transient":          30_000,   # 45% → 13500
        "fraud":              20_000,   # 0%  → 0
    }
    result = estimate_recovery(breakdown=breakdown, total_amount_cents=100_000)
    assert result.recoverable_amount_cents == 17_500 + 13_500 + 0
    assert len(result.segments) == 3
    fraud_seg = next(s for s in result.segments if s.category == "fraud")
    assert fraud_seg.recoverable_cents == 0
    assert fraud_seg.do_not_retry is True


# ---------------------------------------------------------------------------
# Confidence band is ±20%
# ---------------------------------------------------------------------------

def test_confidence_band_is_20_percent() -> None:
    result = estimate_recovery(
        breakdown={"insufficient_funds": 100_000},
        total_amount_cents=100_000,
    )
    mid = result.recoverable_amount_cents
    assert result.confidence_low_cents == int(mid * 0.80)
    assert result.confidence_high_cents == int(mid * 1.20)


# ---------------------------------------------------------------------------
# Default-mix path
# ---------------------------------------------------------------------------

def test_default_mix_path_sets_flag() -> None:
    result = estimate_recovery(breakdown=None, total_amount_cents=200_000)
    assert result.used_default_mix is True


def test_default_mix_segments_match_config() -> None:
    result = estimate_recovery(breakdown=None, total_amount_cents=100_000)
    returned_cats = {s.category for s in result.segments}
    expected_cats = set(DEFAULT_DECLINE_MIX.keys())
    assert returned_cats == expected_cats


def test_explicit_breakdown_clears_default_mix_flag() -> None:
    result = estimate_recovery(
        breakdown={"insufficient_funds": 100_000},
        total_amount_cents=100_000,
    )
    assert result.used_default_mix is False


# ---------------------------------------------------------------------------
# Unknown category falls back gracefully
# ---------------------------------------------------------------------------

def test_unknown_category_uses_fallback_rate() -> None:
    result = estimate_recovery(
        breakdown={"completely_made_up_code": 10_000},
        total_amount_cents=10_000,
    )
    assert len(result.segments) == 1
    assert result.segments[0].category == "unknown"
    expected = int(10_000 * SEGMENT_CONFIG["unknown"]["rate"])
    assert result.segments[0].recoverable_cents == expected


# ---------------------------------------------------------------------------
# Disclaimer is always present
# ---------------------------------------------------------------------------

def test_disclaimer_always_present() -> None:
    result = estimate_recovery(breakdown=None, total_amount_cents=1_000)
    assert "estimate" in result.disclaimer.lower()


# ---------------------------------------------------------------------------
# DEFAULT_DECLINE_MIX sanity
# ---------------------------------------------------------------------------

def test_default_decline_mix_sums_to_one() -> None:
    total = sum(DEFAULT_DECLINE_MIX.values())
    assert abs(total - 1.0) < 1e-9
